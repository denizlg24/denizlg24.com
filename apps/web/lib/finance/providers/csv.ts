import type {
  FinanceConnectionState,
  FinanceInstitution,
  FinanceProviderAccount,
  FinanceProviderBalance,
  FinanceProviderTransaction,
} from "@repo/schemas";
import { merchantFingerprint, normalizeFinanceDescriptor } from "../core";
import { parseDecimalMinor } from "./enable-banking";
import type { BankProvider } from "./types";

interface CsvProviderOptions {
  account: Omit<FinanceProviderAccount, "providerSessionRef">;
  csv: string;
  fetchedAt?: Date;
}

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values.map((item) => item.trim());
}

export function parseFinanceCsv(
  csv: string,
  accountRef: string,
): FinanceProviderTransaction[] {
  const lines = csv
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  const headers = parseCsvLine(lines.shift() ?? "").map((header) =>
    header.toLowerCase(),
  );
  const column = (name: string) => headers.indexOf(name);
  for (const required of ["date", "amount", "currency", "description"]) {
    if (column(required) < 0) {
      throw new Error(`CSV is missing the ${required} column`);
    }
  }

  return lines.map((line) => {
    const values = parseCsvLine(line);
    const date = values[column("date")] ?? "";
    const currency = (values[column("currency")] ?? "").toUpperCase();
    const descriptor = values[column("description")] ?? "";
    const normalizedDescriptor = normalizeFinanceDescriptor(descriptor);
    const explicitId =
      column("transaction_id") >= 0
        ? values[column("transaction_id")]
        : undefined;
    return {
      accountRef,
      providerTxnId:
        explicitId ||
        `csv:${merchantFingerprint(
          [date, values[column("amount")], currency, normalizedDescriptor].join(
            "\0",
          ),
        )}`,
      transactionId: explicitId,
      status:
        column("status") >= 0 &&
        values[column("status")]?.toLowerCase() === "pending"
          ? "pending"
          : "booked",
      bookingDate: date,
      valueDate: date,
      amountMinor: parseDecimalMinor(values[column("amount")] ?? "", currency),
      currency,
      descriptor,
      normalizedDescriptor,
    };
  });
}

export class CsvBankProvider implements BankProvider {
  readonly #account: FinanceProviderAccount;
  readonly #transactions: FinanceProviderTransaction[];
  readonly #fetchedAt: Date;

  constructor(options: CsvProviderOptions) {
    this.#account = options.account;
    this.#transactions = parseFinanceCsv(
      options.csv,
      options.account.accountRef,
    );
    this.#fetchedAt = options.fetchedAt ?? new Date();
  }

  async listInstitutions(_country: string): Promise<FinanceInstitution[]> {
    return [{ id: "csv", name: "CSV", country: "ZZ" }];
  }

  async beginLink(_institutionId: string, _redirectUrl: string) {
    return { linkUrl: "data:text/plain,CSV", ref: "csv" };
  }

  async completeLink(_ref: string) {
    return [this.#account];
  }

  async fetchBalances(accountRef: string): Promise<FinanceProviderBalance[]> {
    const amountMinor = this.#transactions.reduce(
      (total, transaction) => total + transaction.amountMinor,
      0,
    );
    return [
      {
        accountRef,
        balanceType: "CLBD",
        amountMinor,
        currency: this.#account.currency,
        fetchedAt: this.#fetchedAt.toISOString(),
      },
    ];
  }

  async fetchTransactions(_accountRef: string) {
    return this.#transactions;
  }

  async connectionState(_accountRef: string): Promise<FinanceConnectionState> {
    return { status: "active" };
  }
}
