import type {
  FinanceConnectionState,
  FinanceInstitution,
  FinanceProviderAccount,
  FinanceProviderBalance,
  FinanceProviderTransaction,
} from "@repo/schemas";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";
import { normalizeFinanceDescriptor } from "@/lib/finance/core";
import {
  type BankProvider,
  ProviderBudgetExhaustedError,
  type ProviderFetchContext,
  type ProviderRequestKind,
} from "./types";

const API_URL = "https://api.enablebanking.com";
const JWT_TTL_SECONDS = 300;

let cachedJwt:
  | {
      applicationId: string;
      token: string;
      expiresAtSeconds: number;
    }
  | undefined;

const amountSchema = z.object({
  currency: z.string(),
  amount: z.string(),
});

const aspspSchema = z.object({
  name: z.string(),
  country: z.string(),
  logo: z.string().optional(),
  maximum_consent_validity: z.number().int().positive(),
});

const accountSchema = z.object({
  uid: z.string(),
  identification_hash: z.string(),
  name: z.string().optional(),
  details: z.string().optional(),
  currency: z.string().optional(),
});

const transactionSchema = z.object({
  entry_reference: z.string().optional(),
  transaction_id: z.string().optional(),
  internal_transaction_id: z.string().optional(),
  transaction_amount: amountSchema,
  credit_debit_indicator: z.enum(["CRDT", "DBIT"]),
  status: z.string(),
  booking_date: z.string().optional(),
  value_date: z.string().optional(),
  transaction_date: z.string().optional(),
  remittance_information: z.array(z.string()).optional(),
  creditor: z.object({ name: z.string().optional() }).optional(),
  debtor: z.object({ name: z.string().optional() }).optional(),
  bank_transaction_code: z
    .object({ description: z.string().optional() })
    .optional(),
  note: z.string().optional(),
});

function requiredEnvironment() {
  const applicationId = process.env.ENABLE_BANKING_APPLICATION_ID?.trim();
  const encodedKey = process.env.ENABLE_BANKING_PRIVATE_KEY_B64?.trim();
  if (!applicationId || !encodedKey) {
    throw new Error(
      "ENABLE_BANKING_APPLICATION_ID and ENABLE_BANKING_PRIVATE_KEY_B64 are required",
    );
  }
  const privateKey = Buffer.from(encodedKey, "base64").toString("utf8");
  if (!privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      "ENABLE_BANKING_PRIVATE_KEY_B64 must contain a base64-encoded PKCS#8 private key",
    );
  }
  return { applicationId, privateKey };
}

export async function getEnableBankingJwt(now = new Date()) {
  const { applicationId, privateKey } = requiredEnvironment();
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  if (
    cachedJwt?.applicationId === applicationId &&
    cachedJwt.expiresAtSeconds - nowSeconds > 30
  ) {
    return cachedJwt.token;
  }

  const expiresAtSeconds = nowSeconds + JWT_TTL_SECONDS;
  const key = await importPKCS8(privateKey, "RS256");
  const token = await new SignJWT({})
    .setProtectedHeader({
      typ: "JWT",
      alg: "RS256",
      kid: applicationId,
    })
    .setIssuer("enablebanking.com")
    .setAudience("api.enablebanking.com")
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAtSeconds)
    .sign(key);

  cachedJwt = { applicationId, token, expiresAtSeconds };
  return token;
}

export function resetEnableBankingJwtCacheForTests() {
  cachedJwt = undefined;
}

export function parseDecimalMinor(amount: string, currency: string) {
  const match = amount.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error("Provider returned an invalid decimal amount");
  const fractionDigits =
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2;
  const fraction = match[3] ?? "";
  if (fraction.length > fractionDigits) {
    const discarded = fraction.slice(fractionDigits);
    if (!/^0*$/.test(discarded)) {
      throw new Error("Provider amount has unsupported fractional precision");
    }
  }
  const padded = fraction.slice(0, fractionDigits).padEnd(fractionDigits, "0");
  const minor = Number(match[2]) * 10 ** fractionDigits + Number(padded || "0");
  const signed = match[1] === "-" ? -minor : minor;
  if (!Number.isSafeInteger(signed)) {
    throw new Error("Provider amount exceeds safe integer range");
  }
  return signed;
}

interface EncodedInstitution {
  name: string;
  country: string;
  maximumConsentValidity: number;
}

function institutionId(institution: EncodedInstitution) {
  return Buffer.from(JSON.stringify(institution)).toString("base64url");
}

function parseInstitutionId(value: string): EncodedInstitution {
  const parsed = JSON.parse(
    Buffer.from(value, "base64url").toString("utf8"),
  ) as Partial<EncodedInstitution>;
  if (
    !parsed.name ||
    !parsed.country ||
    !parsed.maximumConsentValidity ||
    parsed.maximumConsentValidity <= 0
  ) {
    throw new Error("Invalid Enable Banking institution");
  }
  return parsed as EncodedInstitution;
}

function normalizeDateTime(value: string) {
  return new Date(value).toISOString();
}

function descriptorForTransaction(
  transaction: z.infer<typeof transactionSchema>,
) {
  const parts = [
    ...(transaction.remittance_information ?? []),
    transaction.creditor?.name,
    transaction.debtor?.name,
    transaction.bank_transaction_code?.description,
    transaction.note,
  ].filter((value): value is string => Boolean(value?.trim()));
  return [...new Set(parts)].join(" · ") || "Transaction";
}

export class EnableBankingError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "EnableBankingError";
  }
}

export class EnableBankingProvider implements BankProvider {
  readonly #baseUrl: string;
  readonly #fetch: typeof fetch;
  readonly #context: ProviderFetchContext;
  lastTransactionFetchComplete = true;

  constructor(options?: {
    baseUrl?: string;
    fetch?: typeof fetch;
    context?: ProviderFetchContext;
  }) {
    this.#baseUrl = options?.baseUrl ?? API_URL;
    this.#fetch = options?.fetch ?? fetch;
    this.#context = options?.context ?? {};
  }

  async #request<T>(
    path: string,
    init?: RequestInit,
    requestKind?: ProviderRequestKind,
  ): Promise<T> {
    if (
      requestKind &&
      this.#context.beforeRequest &&
      !(await this.#context.beforeRequest(requestKind))
    ) {
      throw new ProviderBudgetExhaustedError();
    }

    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${await getEnableBankingJwt()}`);
    if (init?.body) headers.set("Content-Type", "application/json");
    if (this.#context.psuIpAddress) {
      headers.set("Psu-Ip-Address", this.#context.psuIpAddress);
    }
    if (this.#context.psuUserAgent) {
      headers.set("Psu-User-Agent", this.#context.psuUserAgent);
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (error) {
      if (requestKind) await this.#context.onRequestFailure?.(requestKind);
      throw error;
    }
    if (!response.ok) {
      if (requestKind) await this.#context.onRequestFailure?.(requestKind);
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
        error?: string;
        message?: string;
      };
      throw new EnableBankingError(
        body.message || body.error || `Enable Banking request failed`,
        response.status,
        body.code,
      );
    }
    return (await response.json()) as T;
  }

  async listInstitutions(country: string): Promise<FinanceInstitution[]> {
    const parsed = z
      .object({ aspsps: z.array(aspspSchema) })
      .parse(
        await this.#request<unknown>(
          `/aspsps?country=${encodeURIComponent(country.toUpperCase())}`,
        ),
      );
    return parsed.aspsps
      .filter((institution) =>
        institution.country.toUpperCase().startsWith(country.toUpperCase()),
      )
      .map((institution) => ({
        id: institutionId({
          name: institution.name,
          country: institution.country.slice(0, 2).toUpperCase(),
          maximumConsentValidity: institution.maximum_consent_validity,
        }),
        name: institution.name,
        country: institution.country.slice(0, 2).toUpperCase(),
        logoUrl: institution.logo,
      }));
  }

  async beginLink(institutionIdValue: string, redirectUrl: string) {
    const institution = parseInstitutionId(institutionIdValue);
    const state = crypto.randomUUID();
    const maximumValidity = Math.min(
      institution.maximumConsentValidity,
      180 * 24 * 60 * 60,
    );
    const validUntil = new Date(Date.now() + maximumValidity * 1_000);
    const response = z
      .object({
        url: z.string().url(),
        authorization_id: z.string(),
      })
      .parse(
        await this.#request<unknown>("/auth", {
          method: "POST",
          body: JSON.stringify({
            access: {
              balances: true,
              transactions: true,
              valid_until: validUntil.toISOString(),
            },
            aspsp: {
              name: institution.name,
              country: institution.country,
            },
            state,
            redirect_url: redirectUrl,
            psu_type: "personal",
          }),
        }),
      );
    return { linkUrl: response.url, ref: state };
  }

  async completeLink(code: string): Promise<FinanceProviderAccount[]> {
    const response = z
      .object({
        session_id: z.string(),
        accounts: z.array(accountSchema),
        aspsp: z.object({ name: z.string(), country: z.string() }),
      })
      .parse(
        await this.#request<unknown>("/sessions", {
          method: "POST",
          body: JSON.stringify({ code }),
        }),
      );

    return response.accounts.map((account) => ({
      accountRef: account.uid,
      providerSessionRef: response.session_id,
      identificationHash: account.identification_hash,
      institutionId: `${response.aspsp.country}:${response.aspsp.name}`,
      institutionName: response.aspsp.name,
      displayName:
        account.name || account.details || `${response.aspsp.name} account`,
      currency: (account.currency || "EUR").toUpperCase(),
    }));
  }

  async fetchBalances(accountRef: string): Promise<FinanceProviderBalance[]> {
    const response = z
      .object({
        balances: z.array(
          z.object({
            balance_amount: amountSchema,
            balance_type: z.string(),
            reference_date: z.string().optional(),
          }),
        ),
      })
      .parse(
        await this.#request<unknown>(
          `/accounts/${encodeURIComponent(accountRef)}/balances`,
          undefined,
          "balance",
        ),
      );
    const fetchedAt = new Date().toISOString();
    return response.balances.map((balance) => ({
      accountRef,
      balanceType: balance.balance_type,
      amountMinor: parseDecimalMinor(
        balance.balance_amount.amount,
        balance.balance_amount.currency,
      ),
      currency: balance.balance_amount.currency.toUpperCase(),
      referenceDate: balance.reference_date,
      fetchedAt,
    }));
  }

  async fetchTransactions(
    accountRef: string,
  ): Promise<FinanceProviderTransaction[]> {
    const transactions: FinanceProviderTransaction[] = [];
    let continuationKey: string | undefined;
    this.lastTransactionFetchComplete = true;

    do {
      const query = new URLSearchParams();
      // Enable Banking rejects date_to without date_from (422), so the range
      // is only ever sent as a pair.
      if (this.#context.dateFrom) {
        query.set("date_from", this.#context.dateFrom);
        if (this.#context.dateTo) query.set("date_to", this.#context.dateTo);
      }
      if (this.#context.initialBackfill) query.set("strategy", "longest");
      if (continuationKey) {
        query.set("continuation_key", continuationKey);
      }

      let response: {
        transactions: z.infer<typeof transactionSchema>[];
        continuation_key?: string | null;
      };
      try {
        response = z
          .object({
            transactions: z.array(transactionSchema),
            continuation_key: z.string().nullish(),
          })
          .parse(
            await this.#request<unknown>(
              `/accounts/${encodeURIComponent(accountRef)}/transactions?${query}`,
              undefined,
              "transaction",
            ),
          );
      } catch (error) {
        if (
          error instanceof ProviderBudgetExhaustedError &&
          transactions.length > 0
        ) {
          this.lastTransactionFetchComplete = false;
          break;
        }
        throw error;
      }

      for (const transaction of response.transactions) {
        if (transaction.status === "CNCL" || transaction.status === "RJCT") {
          continue;
        }
        const descriptor = descriptorForTransaction(transaction);
        const currency = transaction.transaction_amount.currency.toUpperCase();
        const unsigned = Math.abs(
          parseDecimalMinor(transaction.transaction_amount.amount, currency),
        );
        const valueDate =
          transaction.value_date ??
          transaction.booking_date ??
          transaction.transaction_date;
        if (!valueDate) continue;
        transactions.push({
          accountRef,
          providerTxnId:
            transaction.transaction_id ?? transaction.entry_reference,
          transactionId: transaction.transaction_id,
          internalTransactionId:
            transaction.internal_transaction_id ?? transaction.entry_reference,
          status: transaction.status === "BOOK" ? "booked" : "pending",
          bookingDate: transaction.booking_date,
          valueDate,
          amountMinor:
            transaction.credit_debit_indicator === "DBIT"
              ? -unsigned
              : unsigned,
          currency,
          descriptor,
          normalizedDescriptor: normalizeFinanceDescriptor(descriptor),
        });
      }
      continuationKey = response.continuation_key ?? undefined;
    } while (continuationKey);

    return transactions;
  }

  async connectionState(_accountRef: string): Promise<FinanceConnectionState> {
    if (!this.#context.sessionRef) {
      return { status: "reconnect_required" };
    }
    const response = z
      .object({
        status: z.string(),
        access: z.object({ valid_until: z.string() }),
      })
      .parse(
        await this.#request<unknown>(
          `/sessions/${encodeURIComponent(this.#context.sessionRef)}`,
        ),
      );
    const accessValidUntil = normalizeDateTime(response.access.valid_until);
    const expired = Date.parse(accessValidUntil) <= Date.now();
    if (
      expired ||
      ["EXPIRED", "CLOSED", "REVOKED", "INVALID", "CANCELLED"].includes(
        response.status,
      )
    ) {
      return { status: "reconnect_required", accessValidUntil };
    }
    if (response.status === "AUTHORIZED") {
      return { status: "active", accessValidUntil };
    }
    return { status: "pending", accessValidUntil };
  }
}
