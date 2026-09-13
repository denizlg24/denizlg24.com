import type { McpServer } from "@modelcontextprotocol/server";
import {
  financeAccountSettingsInputSchema,
  financeBeginLinkRequestSchema,
  financeBudgetAlertDecisionSchema,
  financeBudgetAlertKindSchema,
  financeBudgetAlertSeveritySchema,
  financeBudgetSuggestionDecisionSchema,
  financeCategoryDeleteSchema,
  financeCategoryInputSchema,
  financeCsvImportInputSchema,
  financeEnvelopeContributionInputSchema,
  financeEnvelopeInputSchema,
  financeEnvelopePeriodSchema,
  financeEnvelopeUpdateSchema,
  financeExpectedEntryInputSchema,
  financeFxSnapshotSchema,
  financeLedgerEntryUpdateSchema,
  financeManualEntryInputSchema,
  financeManualLinkInputSchema,
  financeMatchDecisionSchema,
  financeNaturalEntryInputSchema,
  financeRecurringRuleInputSchema,
  financeSettingsInputSchema,
} from "@repo/schemas";
import { z } from "zod";
import { type Api, action, defineActions, p } from "../define";

const base = "/api/admin/finance";
const id = z.string().min(1).describe("Mongo _id");
const byId = z.object({ id });

export function registerWebFinance(server: McpServer, api: Api) {
  defineActions(server, {
    name: "web_finance",
    title: "Web: finance",
    description: "Ledger overview, settings, bank linking, FX and imports.",
    actions: {
      overview: action({
        description: "Accounts, ledger, forecast and recurring commitments",
        readOnly: true,
        run: () => api.web.get(base),
      }),
      settings_get: action({
        description: "Base currency and FX source",
        readOnly: true,
        run: () => api.web.get(`${base}/settings`),
      }),
      settings_update: action({
        description: "Changes base currency or FX source",
        input: z.object(financeSettingsInputSchema.shape),
        idempotent: true,
        run: (body) => api.web.patch(`${base}/settings`, body),
      }),
      institutions: action({
        description: "Linkable institutions, optionally one ISO country",
        input: z.object({ country: z.string().length(2).optional() }),
        readOnly: true,
        run: ({ country }) => api.web.get(`${base}/institutions`, { country }),
      }),
      link_begin: action({
        description: "Starts a bank link; returns the redirect",
        input: z.object(financeBeginLinkRequestSchema.shape),
        run: (body) => api.web.post(`${base}/link`, body),
      }),
      fx_set: action({
        description: "Records an FX snapshot for a date",
        input: z.object(financeFxSnapshotSchema.shape),
        idempotent: true,
        run: (body) => api.web.post(`${base}/fx`, body),
      }),
      fx_refresh: action({
        description: "Pulls today's rates from the FX source",
        run: () => api.web.post(`${base}/fx/refresh`),
      }),
      narrative: action({
        description: "Generates the finance narrative",
        run: () => api.web.post(`${base}/narrative`),
      }),
      csv_import: action({
        description: "Imports rows from CSV text",
        input: z.object(financeCsvImportInputSchema.shape),
        run: (body) => api.web.post(`${base}/csv`, body),
      }),
    },
  });

  defineActions(server, {
    name: "web_finance_accounts",
    title: "Web: finance accounts",
    description: "Linked bank accounts.",
    actions: {
      update: action({
        description: "Changes display name or fetch budget",
        input: z.object({ id, ...financeAccountSettingsInputSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/finance/accounts/${id}`, body),
      }),
      delete: action({
        description: "Unlinks an account",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/finance/accounts/${id}`),
      }),
      sync: action({
        description: "Fetches new transactions now (counts against the budget)",
        input: byId,
        run: ({ id }) =>
          api.web.post(p`/api/admin/finance/accounts/${id}/sync`),
      }),
    },
  });

  defineActions(server, {
    name: "web_finance_categories",
    title: "Web: finance categories",
    description: "Spending categories.",
    actions: {
      list: action({
        description: "Every category",
        readOnly: true,
        run: () => api.web.get(`${base}/categories`),
      }),
      create: action({
        description: "Creates a category",
        input: z.object(financeCategoryInputSchema.shape),
        run: (body) => api.web.post(`${base}/categories`, body),
      }),
      update: action({
        description: "Changes a category",
        input: z.object({ id, ...financeCategoryInputSchema.partial().shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/finance/categories/${id}`, body),
      }),
      delete: action({
        description: "Deletes a category, optionally moving its rows",
        input: z.object({ id, ...financeCategoryDeleteSchema.shape }),
        destructive: true,
        run: ({ id, ...body }) =>
          api.web.delete(
            p`/api/admin/finance/categories/${id}`,
            undefined,
            body,
          ),
      }),
    },
  });

  defineActions(server, {
    name: "web_finance_entries",
    title: "Web: finance entries",
    description: "Manual and expected ledger entries and bank-row matching.",
    actions: {
      create: action({
        description: "Adds a manual entry",
        input: z.object(financeManualEntryInputSchema.shape),
        run: (body) => api.web.post(`${base}/entries`, body),
      }),
      create_expected: action({
        description: "Adds an expected (projected) entry",
        input: z.object(financeExpectedEntryInputSchema.shape),
        run: (body) => api.web.post(`${base}/entries/expected`, body),
      }),
      parse: action({
        description: "Parses natural-language text into an entry",
        input: z.object(financeNaturalEntryInputSchema.shape),
        run: (body) => api.web.post(`${base}/entries/parse`, body),
      }),
      update: action({
        description: "Changes category, descriptor, amount or date",
        input: z.object({ id, ...financeLedgerEntryUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/finance/entries/${id}`, body),
      }),
      delete: action({
        description: "Deletes an entry",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/finance/entries/${id}`),
      }),
      link: action({
        description: "Links an entry to a bank row",
        input: z.object({ id, ...financeManualLinkInputSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.post(p`/api/admin/finance/entries/${id}/link`, body),
      }),
      unlink: action({
        description: "Removes the bank-row link",
        input: byId,
        idempotent: true,
        run: ({ id }) =>
          api.web.delete(p`/api/admin/finance/entries/${id}/link`),
      }),
      match_decide: action({
        description: "accept, reject or unlink a proposed match",
        input: z.object({
          id,
          decision: financeMatchDecisionSchema.shape.action,
        }),
        idempotent: true,
        run: ({ id, decision }) =>
          api.web.patch(p`/api/admin/finance/matches/${id}`, {
            action: decision,
          }),
      }),
    },
  });

  defineActions(server, {
    name: "web_finance_rules",
    title: "Web: recurring rules",
    description: "Recurring income and expense rules.",
    actions: {
      create: action({
        description: "Creates a rule",
        input: z.object(financeRecurringRuleInputSchema.shape),
        run: (body) => api.web.post(`${base}/rules`, body),
      }),
      update: action({
        description: "Changes a rule",
        input: z.object({
          id,
          ...financeRecurringRuleInputSchema.partial().shape,
        }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/finance/rules/${id}`, body),
      }),
      delete: action({
        description: "Deletes a rule",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/finance/rules/${id}`),
      }),
    },
  });

  defineActions(server, {
    name: "web_finance_budget",
    title: "Web: finance budget",
    description: "Budget tab: envelope status, alerts and coach suggestions.",
    actions: {
      get: action({
        description: "Whole budget tab",
        readOnly: true,
        run: () => api.web.get(`${base}/budget`),
      }),
      drafts: action({
        description: "Starter limits derived from history",
        input: z.object({
          period: financeEnvelopePeriodSchema.optional(),
          periods: z.number().int().min(1).optional(),
          headroomPercent: z.number().min(0).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/budget/drafts`, query),
      }),
      alerts_list: action({
        description: "Alerts filtered by status, severity or kind",
        input: z.object({
          status: z
            .array(z.enum(["open", "acknowledged", "resolved"]))
            .optional(),
          severity: z.array(financeBudgetAlertSeveritySchema).optional(),
          kind: z.array(financeBudgetAlertKindSchema).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/budget/alerts`, query),
      }),
      alerts_reevaluate: action({
        description: "Re-derives alerts now",
        run: () => api.web.post(`${base}/budget/alerts`),
      }),
      alert_decide: action({
        description: "acknowledge, reopen or resolve an alert",
        input: z.object({
          id,
          decision: financeBudgetAlertDecisionSchema.shape.action,
        }),
        idempotent: true,
        run: ({ id, decision }) =>
          api.web.patch(p`/api/admin/finance/budget/alerts/${id}`, {
            action: decision,
          }),
      }),
      suggestions_list: action({
        description: "Coach suggestions, optionally by status",
        input: z.object({
          status: z.array(z.enum(["open", "applied", "dismissed"])).optional(),
        }),
        readOnly: true,
        run: (query) => api.web.get(`${base}/budget/suggestions`, query),
      }),
      suggestions_regenerate: action({
        description: "Asks the coach model for fresh suggestions",
        run: () => api.web.post(`${base}/budget/suggestions`),
      }),
      suggestion_decide: action({
        description: "apply or dismiss a suggestion (422 when refused)",
        input: z.object({
          id,
          decision: financeBudgetSuggestionDecisionSchema.shape.action,
        }),
        idempotent: true,
        run: ({ id, decision }) =>
          api.web.patch(p`/api/admin/finance/budget/suggestions/${id}`, {
            action: decision,
          }),
      }),
    },
  });

  const contributionId = z.string().min(1).describe("Contribution id");
  defineActions(server, {
    name: "web_finance_envelopes",
    title: "Web: finance envelopes",
    description: "Budget envelopes and sinking-fund contributions.",
    actions: {
      list: action({
        description: "Envelopes, archived ones on request",
        input: z.object({ includeArchived: z.boolean().optional() }),
        readOnly: true,
        run: ({ includeArchived }) =>
          api.web.get(`${base}/envelopes`, { includeArchived }),
      }),
      get: action({
        description: "One envelope with status",
        input: byId,
        readOnly: true,
        run: ({ id }) => api.web.get(p`/api/admin/finance/envelopes/${id}`),
      }),
      create: action({
        description: "Creates an envelope in the base currency",
        input: z.object(financeEnvelopeInputSchema.shape),
        run: (body) => api.web.post(`${base}/envelopes`, body),
      }),
      update: action({
        description: "Changes an envelope",
        input: z.object({ id, ...financeEnvelopeUpdateSchema.shape }),
        idempotent: true,
        run: ({ id, ...body }) =>
          api.web.patch(p`/api/admin/finance/envelopes/${id}`, body),
      }),
      delete: action({
        description: "Deletes an envelope",
        input: byId,
        destructive: true,
        run: ({ id }) => api.web.delete(p`/api/admin/finance/envelopes/${id}`),
      }),
      contribute: action({
        description: "Records a sinking-fund contribution",
        input: z.object({
          id,
          ...financeEnvelopeContributionInputSchema.shape,
        }),
        run: ({ id, ...body }) =>
          api.web.post(
            p`/api/admin/finance/envelopes/${id}/contributions`,
            body,
          ),
      }),
      contribution_delete: action({
        description: "Removes a contribution",
        input: z.object({ id, contributionId }),
        destructive: true,
        run: ({ id, contributionId }) =>
          api.web.delete(
            p`/api/admin/finance/envelopes/${id}/contributions/${contributionId}`,
          ),
      }),
    },
  });
}
