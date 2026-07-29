import {
  type FinanceAccountSettingsInput,
  type FinanceCsvImportInput,
  type FinanceDashboardResponse,
  type FinanceManualEntryInput,
  type FinanceMatchDecision,
  type FinanceNaturalEntryInput,
  type FinanceRecurringRuleInput,
  financeBeginLinkResponseSchema,
  financeDashboardResponseSchema,
  financeInstitutionSchema,
  financeManualLedgerEntrySchema,
  financeNarrativeResponseSchema,
  financeRecurringRuleSchema,
  financeSyncResponseSchema,
} from "@repo/schemas";
import { z } from "zod";
import type { AdminClient, AdminRequestOptions } from "../client";

const successSchema = z.object({ success: z.literal(true) });
const institutionsResponseSchema = z.object({
  institutions: z.array(financeInstitutionSchema),
});
const accountMutationResponseSchema = z.object({
  account: financeDashboardResponseSchema.shape.accounts.element,
});
const entryMutationResponseSchema = z.object({
  entry: financeManualLedgerEntrySchema,
});
const ruleMutationResponseSchema = z.object({
  rule: financeRecurringRuleSchema,
});

export async function fetchFinanceDashboard(
  client: AdminClient,
  options?: AdminRequestOptions,
): Promise<FinanceDashboardResponse> {
  const response = await client.get<unknown>("finance", options);
  return financeDashboardResponseSchema.parse(response);
}

export async function fetchFinanceInstitutions(
  client: AdminClient,
  country: string,
  options?: AdminRequestOptions,
) {
  const response = await client.get<unknown>(
    `finance/institutions?country=${encodeURIComponent(country.toUpperCase())}`,
    options,
  );
  return institutionsResponseSchema.parse(response).institutions;
}

export async function beginFinanceLink(
  client: AdminClient,
  input: { institutionId: string; redirectUrl: string },
) {
  const response = await client.post<unknown>("finance/link", input);
  return financeBeginLinkResponseSchema.parse(response);
}

export async function syncFinanceAccount(
  client: AdminClient,
  accountId: string,
) {
  const response = await client.post<unknown>(
    `finance/accounts/${encodeURIComponent(accountId)}/sync`,
  );
  return financeSyncResponseSchema.parse(response);
}

export async function updateFinanceAccount(
  client: AdminClient,
  accountId: string,
  input: FinanceAccountSettingsInput,
) {
  const response = await client.patch<unknown>(
    `finance/accounts/${encodeURIComponent(accountId)}`,
    input,
  );
  return successSchema.parse(response);
}

export async function disconnectFinanceAccount(
  client: AdminClient,
  accountId: string,
) {
  const response = await client.del<unknown>(
    `finance/accounts/${encodeURIComponent(accountId)}`,
  );
  return successSchema.parse(response);
}

export async function createFinanceEntry(
  client: AdminClient,
  input: FinanceManualEntryInput,
) {
  const response = await client.post<unknown>("finance/entries", input);
  return entryMutationResponseSchema.parse(response).entry;
}

export async function createNaturalFinanceEntry(
  client: AdminClient,
  input: FinanceNaturalEntryInput,
) {
  const response = await client.post<unknown>("finance/entries/parse", input);
  return entryMutationResponseSchema.parse(response).entry;
}

export async function createFinanceRule(
  client: AdminClient,
  input: FinanceRecurringRuleInput,
) {
  const response = await client.post<unknown>("finance/rules", input);
  return ruleMutationResponseSchema.parse(response).rule;
}

export async function updateFinanceRule(
  client: AdminClient,
  ruleId: string,
  input: Partial<FinanceRecurringRuleInput>,
) {
  const response = await client.patch<unknown>(
    `finance/rules/${encodeURIComponent(ruleId)}`,
    input,
  );
  return ruleMutationResponseSchema.parse(response).rule;
}

export async function deleteFinanceRule(client: AdminClient, ruleId: string) {
  const response = await client.del<unknown>(
    `finance/rules/${encodeURIComponent(ruleId)}`,
  );
  return successSchema.parse(response);
}

export async function resolveFinanceMatch(
  client: AdminClient,
  reviewId: string,
  action: FinanceMatchDecision["action"],
) {
  const response = await client.patch<unknown>(
    `finance/matches/${encodeURIComponent(reviewId)}`,
    { action },
  );
  return successSchema.parse(response);
}

export async function importFinanceCsv(
  client: AdminClient,
  input: FinanceCsvImportInput,
) {
  const response = await client.post<unknown>("finance/csv", input);
  return accountMutationResponseSchema.parse(response).account;
}

export async function fetchFinanceNarrative(client: AdminClient) {
  const response = await client.post<unknown>("finance/narrative");
  return financeNarrativeResponseSchema.parse(response);
}
