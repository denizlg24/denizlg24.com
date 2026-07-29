import type {
  FinanceConnectionState,
  FinanceInstitution,
  FinanceProviderAccount,
  FinanceProviderBalance,
  FinanceProviderTransaction,
} from "@repo/schemas";

export interface BankProvider {
  listInstitutions(country: string): Promise<FinanceInstitution[]>;
  beginLink(
    institutionId: string,
    redirectUrl: string,
  ): Promise<{ linkUrl: string; ref: string }>;
  completeLink(ref: string): Promise<FinanceProviderAccount[]>;
  fetchBalances(accountRef: string): Promise<FinanceProviderBalance[]>;
  fetchTransactions(accountRef: string): Promise<FinanceProviderTransaction[]>;
  connectionState(accountRef: string): Promise<FinanceConnectionState>;
}

export type ProviderRequestKind = "balance" | "transaction";

export interface ProviderFetchContext {
  sessionRef?: string;
  dateFrom?: string;
  dateTo?: string;
  initialBackfill?: boolean;
  psuIpAddress?: string;
  psuUserAgent?: string;
  beforeRequest?: (kind: ProviderRequestKind) => Promise<boolean>;
  onRequestFailure?: (kind: ProviderRequestKind) => Promise<void>;
}

export class ProviderBudgetExhaustedError extends Error {
  constructor() {
    super("Finance provider fetch budget exhausted");
    this.name = "ProviderBudgetExhaustedError";
  }
}
