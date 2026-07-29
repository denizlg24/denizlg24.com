import { createHash } from "node:crypto";
import type {
  FinanceBeginLinkRequest,
  FinanceProviderAccount,
} from "@repo/schemas";
import { connectDB } from "@/lib/mongodb";
import { FinanceAccount, FinanceLinkState } from "@/models/Finance";
import { financeAccountBindingKey, financeBudgetDayKey } from "./core";
import { EnableBankingProvider } from "./providers/enable-banking";
import { encryptFinanceSecret } from "./secrets";

const LINK_STATE_TTL_MS = 15 * 60 * 1_000;

function stateHash(state: string) {
  return createHash("sha256").update(state).digest("hex");
}

export async function listFinanceInstitutions(country: string) {
  const provider = new EnableBankingProvider();
  return provider.listInstitutions(country);
}

export async function beginFinanceLink(input: FinanceBeginLinkRequest) {
  await connectDB();
  const provider = new EnableBankingProvider();
  const result = await provider.beginLink(
    input.institutionId,
    input.redirectUrl,
  );
  await FinanceLinkState.create({
    stateHash: stateHash(result.ref),
    institutionId: input.institutionId,
    redirectUrl: input.redirectUrl,
    expiresAt: new Date(Date.now() + LINK_STATE_TTL_MS),
  });
  return { linkUrl: result.linkUrl };
}

async function bindProviderAccount(account: FinanceProviderAccount) {
  if (!account.providerSessionRef) {
    throw new Error("Enable Banking response omitted the session reference");
  }
  const now = new Date();
  const provider = new EnableBankingProvider({
    context: { sessionRef: account.providerSessionRef },
  });
  const connection = await provider.connectionState(account.accountRef);
  const existing = await FinanceAccount.findOne({
    identificationHash: financeAccountBindingKey(account),
  });
  if (existing) {
    existing.set({
      provider: "enable-banking",
      providerAccountRef: account.accountRef,
      encryptedProviderSessionRef: encryptFinanceSecret(
        account.providerSessionRef,
      ),
      institutionId: account.institutionId,
      institutionName: account.institutionName,
      displayName: account.displayName,
      currency: account.currency,
      connectionStatus: connection.status,
      accessValidUntil: connection.accessValidUntil
        ? new Date(connection.accessValidUntil)
        : undefined,
    });
    await existing.save();
    return existing;
  }

  return FinanceAccount.create({
    provider: "enable-banking",
    providerAccountRef: account.accountRef,
    identificationHash: account.identificationHash,
    encryptedProviderSessionRef: encryptFinanceSecret(
      account.providerSessionRef,
    ),
    institutionId: account.institutionId,
    institutionName: account.institutionName,
    displayName: account.displayName,
    currency: account.currency,
    connectionStatus: connection.status,
    accessValidUntil: connection.accessValidUntil
      ? new Date(connection.accessValidUntil)
      : undefined,
    dailyFetchLimit: 4,
    fetchesUsed: 0,
    budgetWindowStartedAt: now,
    budgetDayKey: financeBudgetDayKey(now, "UTC"),
    budgetTimezone: "UTC",
    reservedManualFetches: 1,
    countsFailedAttempts: true,
    attendedCallsExempt: false,
  });
}

export async function completeFinanceLink(code: string, state: string) {
  await connectDB();
  const linkState = await FinanceLinkState.findOneAndDelete({
    stateHash: stateHash(state),
    expiresAt: { $gt: new Date() },
  });
  if (!linkState) throw new Error("Invalid or expired finance link state");

  const provider = new EnableBankingProvider();
  const accounts = await provider.completeLink(code);
  const bound = [];
  for (const account of accounts) {
    bound.push(await bindProviderAccount(account));
  }
  return bound;
}
