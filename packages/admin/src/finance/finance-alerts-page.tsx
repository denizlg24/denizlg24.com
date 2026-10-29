"use client";

import type { FinanceBudgetAlert } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { List } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { FilterTabs } from "@repo/ui/toolbar";
import { Bell, Check, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { DetailPageShell } from "../detail-page-shell";
import { useAdmin } from "../provider";
import {
  decideFinanceBudgetAlert,
  evaluateFinanceBudgetAlerts,
  fetchFinanceBudgetAlerts,
} from "./finance-budget-data";
import { relative } from "./finance-primitives";

const ICON = <Bell />;

const SEVERITY_TONE: Record<FinanceBudgetAlert["severity"], StatusTone> = {
  info: "muted",
  warning: "warning",
  critical: "critical",
};

const SEVERITY_BADGE: Record<
  FinanceBudgetAlert["severity"],
  "info" | "warning" | "critical"
> = {
  info: "info",
  warning: "warning",
  critical: "critical",
};

const SEVERITY_RANK: Record<FinanceBudgetAlert["severity"], number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

type Group = FinanceBudgetAlert["status"];
type Decision = "acknowledge" | "reopen" | "resolve";

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
  { action: Decision; label: string; icon: ReactNode }[]
> = {
  open: [
    { action: "acknowledge", label: "Acknowledge", icon: <Check /> },
    { action: "resolve", label: "Resolve", icon: <RotateCcw /> },
  ],
  acknowledged: [
    { action: "resolve", label: "Resolve", icon: <RotateCcw /> },
    { action: "reopen", label: "Reopen", icon: <RefreshCw /> },
  ],
  resolved: [{ action: "reopen", label: "Reopen", icon: <RefreshCw /> }],
};

function AlertRow({
  alert,
  busy,
  onDecide,
}: {
  alert: FinanceBudgetAlert;
  busy: boolean;
  onDecide: (action: Decision) => void;
}) {
  // An alert acknowledged at a lower severity than it now carries came back on
  // purpose: acknowledging "projected to overspend" must not silence "actually
  // overspent". Saying so is what stops that reading as a bug.
  const worsened =
    alert.acknowledgedSeverity !== undefined &&
    SEVERITY_RANK[alert.severity] > SEVERITY_RANK[alert.acknowledgedSeverity];

  return (
    <div role="listitem" className="group/row flex items-start gap-3 py-3">
      <StatusDot
        tone={SEVERITY_TONE[alert.severity]}
        label={alert.severity}
        className="mt-1.5"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm leading-tight text-accent-strong">
            {alert.title}
          </span>
          <Badge variant={SEVERITY_BADGE[alert.severity]}>
            {alert.severity}
          </Badge>
          {worsened && alert.acknowledgedSeverity && (
            <Badge variant="warning">
              was {alert.acknowledgedSeverity} when acknowledged
            </Badge>
          )}
        </div>
        <div className="text-xs leading-snug text-muted-foreground">
          {alert.detail}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-muted-foreground/80">
          <span className="font-mono" title={alert.key}>
            {alert.key}
          </span>
          <span>first {relative(alert.firstSeenAt)}</span>
          <span>last {relative(alert.lastSeenAt)}</span>
          {alert.acknowledgedAt && (
            <span>acknowledged {relative(alert.acknowledgedAt)}</span>
          )}
          {alert.resolvedAt && (
            <span>resolved {relative(alert.resolvedAt)}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        {TRANSITIONS[alert.status].map((transition) => (
          <Button
            key={transition.action}
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => onDecide(transition.action)}
          >
            {busy ? <Loader2 className="animate-spin" /> : transition.icon}
            {transition.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function FinanceAlertsPage({
  embedded = false,
}: {
  embedded?: boolean;
}) {
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
    for (const alert of alerts ?? []) buckets[alert.status].push(alert);
    return buckets;
  }, [alerts]);

  const decide = async (alert: FinanceBudgetAlert, action: Decision) => {
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

  const evaluateButton = (
    <Button
      variant="ghost"
      size="sm"
      disabled={evaluating}
      onClick={() => void evaluate()}
    >
      {evaluating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      Re-evaluate
    </Button>
  );

  const filters = (
    <FilterTabs
      value={group}
      onChange={setGroup}
      options={GROUPS.map((tab) => ({
        ...tab,
        count: alerts ? grouped[tab.value].length : undefined,
      }))}
    />
  );

  const rows =
    alerts === null ? (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    ) : grouped[group].length === 0 ? (
      <EmptyState compact icon={<Bell />} label={`No ${group} alerts`} />
    ) : (
      <List divided>
        {grouped[group].map((alert) => (
          <AlertRow
            key={alert.id}
            alert={alert}
            busy={busyId === alert.id}
            onDecide={(action) => void decide(alert, action)}
          />
        ))}
      </List>
    );

  if (embedded) {
    return (
      <Section title="Alerts" actions={evaluateButton}>
        {filters}
        {rows}
      </Section>
    );
  }

  return (
    <DetailPageShell
      icon={ICON}
      title="Budget alerts"
      backTo={routes.finance.budget}
      backLabel="Budget"
      actions={evaluateButton}
    >
      <div className="flex flex-col gap-3">
        {filters}
        {rows}
      </div>
    </DetailPageShell>
  );
}
