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

function parseCsvRecords(csv: string) {
  const records: string[][] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (character === '"') {
      if (quoted && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      values.push(value);
      records.push(values);
      values = [];
      value = "";
      continue;
    }
    if (character === "," && !quoted) {
      values.push(value);
      value = "";
      continue;
    }
    value += character;
  }

  values.push(value);
  records.push(values);
  return records
    .map((record) => record.map((item) => item.trim()))
    .filter((record) => record.some(Boolean));
}

export function parseFinanceCsv(
  csv: string,
  accountRef: string,
): FinanceProviderTransaction[] {
  const records = parseCsvRecords(csv.replace(/^\uFEFF/, ""));
  const headers = (records.shift() ?? []).map((header) => header.toLowerCase());
  const column = (name: string) => headers.indexOf(name);
  for (const required of ["date", "amount", "currency", "description"]) {
    if (column(required) < 0) {
      throw new Error(`CSV is missing the ${required} column`);
    }
  }
  const occurrences = new Map<string, number>();

  return records.map((values) => {
    const date = values[column("date")] ?? "";
    const currency = (values[column("currency")] ?? "").toUpperCase();
    const descriptor = values[column("description")] ?? "";
    const normalizedDescriptor = normalizeFinanceDescriptor(descriptor);
    const explicitId =
      column("transaction_id") >= 0
        ? values[column("transaction_id")]
        : undefined;
    // Identical rows are legitimate (the same coffee twice in a day), so the
    // occurrence index keeps them distinct and stable across re-imports.
    const identity = [
      date,
      values[column("amount")],
      currency,
      normalizedDescriptor,
    ].join("\0");
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return {
      accountRef,
      providerTxnId:
        explicitId ||
        `csv:${merchantFingerprint(
          occurrence > 0 ? `${identity}\0#${occurrence}` : identity,
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

  // A statement's transaction sum is net movement, not a closing balance, and
  // summing across mixed currencies would be meaningless. Without an explicit
  // balance in the import contract there is nothing truthful to report.
  async fetchBalances(_accountRef: string): Promise<FinanceProviderBalance[]> {
    return [];
  }

  async fetchTransactions(_accountRef: string) {
    return this.#transactions;
  }

  async connectionState(_accountRef: string): Promise<FinanceConnectionState> {
    return { status: "active" };
  }
}
