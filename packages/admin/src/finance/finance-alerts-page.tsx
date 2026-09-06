"use client";

import type { FinanceBudgetAlert } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { Bell, Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { DetailPageShell } from "../detail-page-shell";
import { useAdmin } from "../provider";
import {
  decideFinanceBudgetAlert,
  evaluateFinanceBudgetAlerts,
  fetchFinanceBudgetAlerts,
} from "./finance-budget-data";
import { Empty, relative, SectionHead } from "./finance-primitives";

const ICON = <Bell className="size-4 text-muted-foreground" />;

const SEVERITY_TONE: Record<FinanceBudgetAlert["severity"], StatusTone> = {
  info: "muted",
  warning: "warning",
  critical: "critical",
};

const SEVERITY_RANK: Record<FinanceBudgetAlert["severity"], number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

type Group = "open" | "acknowledged" | "resolved";

const GROUPS: { value: Group; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
];

/**
 * The transitions available from each status.
 *
 * `resolve` is here because it was reachable in the API and nowhere in the UI:
 * `AlertRow`'s `onDecide` was typed to two of the three actions, so the third
 * transition simply did not exist on screen.
 */
const TRANSITIONS: Record<
  Group,
  {
    action: "acknowledge" | "reopen" | "resolve";
    label: string;
    icon: React.ReactNode;
  }[]
> = {
  open: [
    {
      action: "acknowledge",
      label: "Acknowledge",
      icon: <Check className="size-3.5" />,
    },
    {
      action: "resolve",
      label: "Resolve",
      icon: <RotateCcw className="size-3.5" />,
    },
  ],
  acknowledged: [
    {
      action: "resolve",
      label: "Resolve",
      icon: <RotateCcw className="size-3.5" />,
    },
    {
      action: "reopen",
      label: "Reopen",
      icon: <RefreshCw className="size-3.5" />,
    },
  ],
  resolved: [
    {
      action: "reopen",
      label: "Reopen",
      icon: <RefreshCw className="size-3.5" />,
    },
  ],
};

function AlertRow({
  alert,
  busy,
  onDecide,
}: {
  alert: FinanceBudgetAlert;
  busy: boolean;
  onDecide: (action: "acknowledge" | "reopen" | "resolve") => void;
}) {
  const group = alert.status as Group;
  // An alert acknowledged at a lower severity than it now carries came back on
  // purpose: acknowledging "projected to overspend" must not silence "actually
  // overspent". Saying so is what stops that reading as a bug.
  const worsened =
    alert.acknowledgedSeverity !== undefined &&
    SEVERITY_RANK[alert.severity] > SEVERITY_RANK[alert.acknowledgedSeverity];

  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-3 last:border-b-0">
      <StatusDot
        tone={SEVERITY_TONE[alert.severity]}
        label={alert.severity}
        className="mt-1.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-[13px] leading-tight">{alert.title}</span>
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {alert.severity}
          </span>
          {worsened && alert.acknowledgedSeverity && (
            <span className="text-[10px] text-status-warning">
              was {alert.acknowledgedSeverity} when acknowledged
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {alert.detail}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">
          <span title={alert.key}>{alert.key}</span>
          <span>first seen {relative(alert.firstSeenAt)}</span>
          <span>last seen {relative(alert.lastSeenAt)}</span>
          {alert.acknowledgedAt && (
            <span>acknowledged {relative(alert.acknowledgedAt)}</span>
          )}
          {alert.resolvedAt && (
            <span>resolved {relative(alert.resolvedAt)}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {TRANSITIONS[group].map((transition) => (
          <Button
            key={transition.action}
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => onDecide(transition.action)}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              transition.icon
            )}
            {transition.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function FinanceAlertsPage() {
  const { client, routes } = useAdmin();
  const [alerts, setAlerts] = useState<FinanceBudgetAlert[] | null>(null);
  const [group, setGroup] = useState<Group>("open");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const load = useCallback(async () => {
    try {
      setAlerts(
        await fetchFinanceBudgetAlerts(client, [
          "open",
          "acknowledged",
          "resolved",
        ]),
      );
    } catch {
      toast.error("Failed to load alerts");
      setAlerts([]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const buckets: Record<Group, FinanceBudgetAlert[]> = {
      open: [],
      acknowledged: [],
      resolved: [],
    };
    for (const alert of alerts ?? [])
      buckets[alert.status as Group].push(alert);
    return buckets;
  }, [alerts]);

  const decide = async (
    alert: FinanceBudgetAlert,
    action: "acknowledge" | "reopen" | "resolve",
  ) => {
    setBusyId(alert.id);
    try {
      const updated = await decideFinanceBudgetAlert(client, alert.id, action);
      setAlerts(
        (prev) =>
          prev?.map((row) => (row.id === updated.id ? updated : row)) ?? null,
      );
    } catch {
      toast.error(`Failed to ${action}`);
    } finally {
      setBusyId(null);
    }
  };

  const evaluate = async () => {
    setEvaluating(true);
    try {
      const result = await evaluateFinanceBudgetAlerts(client);
      await load();
      toast.success(
        `${result.opened} opened · ${result.updated} updated · ${result.resolved} resolved · ${result.reopened} reopened`,
      );
    } catch {
      toast.error("Failed to re-evaluate");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <DetailPageShell
      icon={ICON}
      title="Budget alerts"
      backTo={routes.finance.budget}
      backLabel="Budget"
      actions={
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          disabled={evaluating}
          onClick={evaluate}
        >
          {evaluating ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          Re-evaluate
        </Button>
      }
    >
      <div className="space-y-5">
        <div className="flex gap-4 border-b">
          {GROUPS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setGroup(tab.value)}
              className={cn(
                "shrink-0 border-b-2 pb-2 text-xs transition-colors",
                group === tab.value
                  ? "border-foreground font-medium text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              <span className="ml-1.5 tabular-nums text-muted-foreground">
                {grouped[tab.value].length}
              </span>
            </button>
          ))}
        </div>

        {alerts === null ? (
          <Empty label="Loading…" />
        ) : grouped[group].length === 0 ? (
          <Empty label="—" />
        ) : (
          <div>
            {group === "open" && <SectionHead label="Currently true" />}
            {grouped[group].map((alert) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                busy={busyId === alert.id}
                onDecide={(action) => decide(alert, action)}
              />
            ))}
          </div>
        )}
      </div>
    </DetailPageShell>
  );
}
