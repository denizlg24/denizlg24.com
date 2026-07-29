import type {
  CreateAgentEvidenceEvent,
  FinanceDashboardResponse,
} from "@repo/schemas";
import {
  buildEvidenceInput,
  observeEvidence,
  stableContentHash,
} from "@/lib/agent-memory/evidence";
import { getFinanceDashboard } from "./dashboard";

function compactFinanceSnapshot(dashboard: FinanceDashboardResponse) {
  return {
    period: dashboard.forecast?.asOfDate.slice(0, 7),
    monthly: dashboard.monthly,
    aggregateBalances: dashboard.aggregateBalances,
    forecast: dashboard.forecast
      ? {
          asOfDate: dashboard.forecast.asOfDate,
          currency: dashboard.forecast.currency,
          p25Minor: dashboard.forecast.p25Minor,
          p50Minor: dashboard.forecast.p50Minor,
          p75Minor: dashboard.forecast.p75Minor,
        }
      : undefined,
    recurringRules: dashboard.recurringRules
      .filter((rule) => rule.status === "active")
      .map((rule) => ({
        name: rule.name,
        direction: rule.direction,
        amountKind: rule.amountKind,
        amountMinor: rule.amountMinor,
        currency: rule.currency,
        recurrence: rule.recurrence,
      })),
  };
}

export function buildFinanceMemoryEvidence(
  dashboard: FinanceDashboardResponse,
  occurredAt = new Date(),
): CreateAgentEvidenceEvent {
  const snapshot = compactFinanceSnapshot(dashboard);
  const revision = stableContentHash(snapshot).slice(0, 32);
  const period =
    dashboard.forecast?.asOfDate.slice(0, 7) ??
    occurredAt.toISOString().slice(0, 7);
  return buildEvidenceInput({
    idempotencyKey: `finance:${period}:${revision}`,
    sourceType: "finance",
    sourceRef: {
      entityType: "finance-month",
      entityId: period,
      revision,
    },
    sourceRevision: revision,
    content: snapshot,
    snapshot: JSON.stringify(snapshot),
    occurredAt,
    actor: "system",
    trust: "derived",
    sensitivity: "sensitive",
    provenance: {
      adapter: "finance-aggregate-v1",
      descriptorPolicy: "aggregate-only",
    },
  });
}

export async function observeFinanceMemorySafely(
  occurredAt = new Date(),
): Promise<void> {
  try {
    const dashboard = await getFinanceDashboard(occurredAt);
    await observeEvidence({
      memoryMode: "enabled",
      evidence: buildFinanceMemoryEvidence(dashboard, occurredAt),
    });
  } catch (error) {
    console.warn("[finance] Agent-memory observation deferred", {
      error: error instanceof Error ? error.message : "unknown error",
    });
  }
}
