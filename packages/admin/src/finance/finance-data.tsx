import {
  type FinanceAccountSettingsInput,
  type FinanceCategoryInput,
  type FinanceCsvImportInput,
  type FinanceDashboardResponse,
  type FinanceDeductionProfileInput,
  type FinanceExpectedEntryInput,
  type FinanceLedgerEntryUpdate,
  type FinanceManualEntryInput,
  type FinanceMatchDecision,
  type FinanceNaturalEntryInput,
  type FinancePayoutOverrideInput,
  type FinanceRecurringRuleInput,
  type FinanceSettingsInput,
  financeBeginLinkResponseSchema,
  financeCategorySchema,
  financeDashboardResponseSchema,
  financeDeductionProfileSchema,
  financeInstitutionSchema,
  financeLedgerEntrySchema,
  financeManualLedgerEntrySchema,
  financeNarrativeResponseSchema,
  financePayoutScheduleResponseSchema,
  financeRecurringRuleSchema,
  financeSettingsSchema,
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
const anyEntryMutationResponseSchema = z.object({
  entry: financeLedgerEntrySchema,
});
const ruleMutationResponseSchema = z.object({
  rule: financeRecurringRuleSchema,
});
const categoryMutationResponseSchema = z.object({
  category: financeCategorySchema,
});
const settingsResponseSchema = z.object({ settings: financeSettingsSchema });
const fxRefreshResponseSchema = z.object({
  base: z.string(),
  source: z.string(),
  date: z.string(),
  updated: z.number().int().nonnegative(),
  unsupported: z.array(z.string()),
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
  input: { institutionId: string },
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

export async function createExpectedFinanceEntry(
  client: AdminClient,
  input: FinanceExpectedEntryInput,
) {
  const response = await client.post<unknown>(
    "finance/entries/expected",
    input,
  );
  return anyEntryMutationResponseSchema.parse(response).entry;
}

export async function updateFinanceEntry(
  client: AdminClient,
  entryId: string,
  input: FinanceLedgerEntryUpdate,
) {
  const response = await client.patch<unknown>(
    `finance/entries/${encodeURIComponent(entryId)}`,
    input,
  );
  return anyEntryMutationResponseSchema.parse(response).entry;
}

export async function linkFinanceEntry(
  client: AdminClient,
  entryId: string,
  bankLedgerId: string,
) {
  const response = await client.post<unknown>(
    `finance/entries/${encodeURIComponent(entryId)}/link`,
    { bankLedgerId },
  );
  return anyEntryMutationResponseSchema.parse(response).entry;
}

export async function unlinkFinanceEntry(client: AdminClient, entryId: string) {
  const response = await client.del<unknown>(
    `finance/entries/${encodeURIComponent(entryId)}/link`,
  );
  return successSchema.parse(response);
}

export async function deleteFinanceEntry(client: AdminClient, entryId: string) {
  const response = await client.del<unknown>(
    `finance/entries/${encodeURIComponent(entryId)}`,
  );
  return successSchema.parse(response);
}

export async function createFinanceCategory(
  client: AdminClient,
  input: FinanceCategoryInput,
) {
  const response = await client.post<unknown>("finance/categories", input);
  return categoryMutationResponseSchema.parse(response).category;
}

export async function updateFinanceCategory(
  client: AdminClient,
  categoryId: string,
  input: Partial<FinanceCategoryInput>,
) {
  const response = await client.patch<unknown>(
    `finance/categories/${encodeURIComponent(categoryId)}`,
    input,
  );
  return categoryMutationResponseSchema.parse(response).category;
}

export async function deleteFinanceCategory(
  client: AdminClient,
  categoryId: string,
  reassignTo?: string,
) {
  const response = await client.raw(
    `finance/categories/${encodeURIComponent(categoryId)}`,
    { method: "DELETE", body: { reassignTo } },
  );
  return successSchema.parse(await response.json());
}

export async function updateFinanceSettings(
  client: AdminClient,
  input: FinanceSettingsInput,
) {
  const response = await client.patch<unknown>("finance/settings", input);
  return settingsResponseSchema.parse(response).settings;
}

export async function refreshFinanceFxRates(client: AdminClient) {
  const response = await client.post<unknown>("finance/fx/refresh");
  return fxRefreshResponseSchema.parse(response);
}

const deductionProfileResponseSchema = z.object({
  profile: financeDeductionProfileSchema,
});

export async function createFinanceDeductionProfile(
  client: AdminClient,
  input: FinanceDeductionProfileInput,
) {
  const response = await client.post<unknown>("finance/deductions", input);
  return deductionProfileResponseSchema.parse(response).profile;
}

export async function updateFinanceDeductionProfile(
  client: AdminClient,
  id: string,
  input: Partial<FinanceDeductionProfileInput>,
) {
  const response = await client.patch<unknown>(
    `finance/deductions/${encodeURIComponent(id)}`,
    input,
  );
  return deductionProfileResponseSchema.parse(response).profile;
}

export async function deleteFinanceDeductionProfile(
  client: AdminClient,
  id: string,
) {
  const response = await client.del<unknown>(
    `finance/deductions/${encodeURIComponent(id)}`,
  );
  return successSchema.parse(response);
}

export async function fetchFinancePayouts(
  client: AdminClient,
  ruleId: string,
  options?: AdminRequestOptions,
) {
  const response = await client.get<unknown>(
    `finance/rules/${encodeURIComponent(ruleId)}/payouts`,
    options,
  );
  return financePayoutScheduleResponseSchema.parse(response);
}

export async function setFinancePayoutOverride(
  client: AdminClient,
  ruleId: string,
  payoutDate: string,
  input: FinancePayoutOverrideInput | null,
) {
  const path = `finance/rules/${encodeURIComponent(ruleId)}/payouts/${payoutDate}`;
  const response = input
    ? await client.put<unknown>(path, input)
    : await client.del<unknown>(path);
  return ruleMutationResponseSchema.parse(response).rule;
}
