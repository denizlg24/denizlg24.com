import {
  type FinanceBudgetAlertDecision,
  type FinanceBudgetSuggestionDecision,
  type FinanceEnvelopeContributionInput,
  type FinanceEnvelopeInputPayload,
  type FinanceEnvelopeUpdatePayload,
  financeBudgetAlertSchema,
  financeBudgetOverviewSchema,
  financeBudgetSuggestionSchema,
  financeEnvelopeDraftSchema,
  financeEnvelopeSchema,
} from "@repo/schemas";
import { z } from "zod";
import type { AdminClient, AdminRequestOptions } from "../client";

const successSchema = z.object({ success: z.literal(true) });
const envelopeMutationSchema = z.object({ envelope: financeEnvelopeSchema });
const alertMutationSchema = z.object({ alert: financeBudgetAlertSchema });
const suggestionsSchema = z.object({
  suggestions: z.array(financeBudgetSuggestionSchema),
});
const suggestionMutationSchema = z.object({
  suggestion: financeBudgetSuggestionSchema,
});
const draftsSchema = z.object({
  drafts: z.array(financeEnvelopeDraftSchema),
});
const evaluationSchema = z.object({
  evaluatedAt: z.string(),
  opened: z.number(),
  updated: z.number(),
  resolved: z.number(),
  reopened: z.number(),
  alerts: z.array(financeBudgetAlertSchema),
});

export async function fetchFinanceBudget(
  client: AdminClient,
  options?: AdminRequestOptions,
) {
  const response = await client.get<unknown>("finance/budget", options);
  return financeBudgetOverviewSchema.parse(response);
}

export async function createFinanceEnvelope(
  client: AdminClient,
  input: FinanceEnvelopeInputPayload,
) {
  const response = await client.post<unknown>("finance/envelopes", input);
  return envelopeMutationSchema.parse(response).envelope;
}

export async function updateFinanceEnvelope(
  client: AdminClient,
  envelopeId: string,
  input: FinanceEnvelopeUpdatePayload,
) {
  const response = await client.patch<unknown>(
    `finance/envelopes/${encodeURIComponent(envelopeId)}`,
    input,
  );
  return envelopeMutationSchema.parse(response).envelope;
}

export async function deleteFinanceEnvelope(
  client: AdminClient,
  envelopeId: string,
) {
  const response = await client.del<unknown>(
    `finance/envelopes/${encodeURIComponent(envelopeId)}`,
  );
  return successSchema.parse(response);
}

export async function contributeToFinanceEnvelope(
  client: AdminClient,
  envelopeId: string,
  input: FinanceEnvelopeContributionInput,
) {
  const response = await client.post<unknown>(
    `finance/envelopes/${encodeURIComponent(envelopeId)}/contributions`,
    input,
  );
  return envelopeMutationSchema.parse(response).envelope;
}

export async function removeFinanceEnvelopeContribution(
  client: AdminClient,
  envelopeId: string,
  contributionId: string,
) {
  const response = await client.del<unknown>(
    `finance/envelopes/${encodeURIComponent(envelopeId)}/contributions/${encodeURIComponent(contributionId)}`,
  );
  return envelopeMutationSchema.parse(response).envelope;
}

export async function evaluateFinanceBudgetAlerts(client: AdminClient) {
  const response = await client.post<unknown>("finance/budget/alerts");
  return evaluationSchema.parse(response);
}

export async function decideFinanceBudgetAlert(
  client: AdminClient,
  alertId: string,
  action: FinanceBudgetAlertDecision["action"],
) {
  const response = await client.patch<unknown>(
    `finance/budget/alerts/${encodeURIComponent(alertId)}`,
    { action },
  );
  return alertMutationSchema.parse(response).alert;
}

export async function generateFinanceBudgetSuggestions(client: AdminClient) {
  const response = await client.post<unknown>("finance/budget/suggestions");
  return suggestionsSchema.parse(response).suggestions;
}

export async function decideFinanceBudgetSuggestion(
  client: AdminClient,
  suggestionId: string,
  action: FinanceBudgetSuggestionDecision["action"],
) {
  const response = await client.patch<unknown>(
    `finance/budget/suggestions/${encodeURIComponent(suggestionId)}`,
    { action },
  );
  return suggestionMutationSchema.parse(response).suggestion;
}

export async function fetchFinanceEnvelopeDrafts(
  client: AdminClient,
  options: { period?: string; periods?: number; headroomPercent?: number } = {},
) {
  const params = new URLSearchParams();
  if (options.period) params.set("period", options.period);
  if (options.periods) params.set("periods", String(options.periods));
  if (options.headroomPercent !== undefined) {
    params.set("headroomPercent", String(options.headroomPercent));
  }
  const query = params.toString();
  const response = await client.get<unknown>(
    `finance/budget/drafts${query ? `?${query}` : ""}`,
  );
  return draftsSchema.parse(response).drafts;
}
