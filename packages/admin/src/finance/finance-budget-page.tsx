"use client";

import type {
  FinanceBudgetOverview,
  FinanceBudgetSuggestion,
  FinanceEnvelopeDraft,
  FinanceEnvelopeStatus,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { majorToMinor } from "@repo/utils";
import {
  ArrowLeft,
  Check,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Sparkles,
  Wallet,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";
import {
  contributeToFinanceEnvelope,
  decideFinanceBudgetSuggestion,
  fetchFinanceBudget,
  fetchFinanceEnvelopeDrafts,
  generateFinanceBudgetSuggestions,
} from "./finance-budget-data";
import { Empty, Figure, relative, SectionHead } from "./finance-primitives";
import { money, shortDay } from "./finance-series";

const SEVERITY_TONE: Record<"info" | "warning" | "critical", StatusTone> = {
  info: "muted",
  warning: "warning",
  critical: "critical",
};

const PERIOD_SHORT: Record<FinanceEnvelopeStatus["period"], string> = {
  weekly: "wk",
  monthly: "mo",
  quarterly: "qtr",
  yearly: "yr",
};

/**
 * A limit bar that can exceed its track.
 *
 * Overspend is drawn as a distinct overflow segment rather than a bar clamped
 * at 100%: the whole point of the row is to show by how much, and a full bar
 * reads identically at 101% and 300%.
 */
function LimitBar({
  spentShare,
  committedShare,
}: {
  spentShare: number;
  committedShare: number;
}) {
  const spent = Math.min(spentShare, 1);
  const committed = Math.min(committedShare, Math.max(0, 1 - spent));
  const over = Math.max(0, spentShare - 1);
  return (
    <div className="flex h-1 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          "h-full",
          over > 0 ? "bg-status-critical" : "bg-foreground",
        )}
        style={{ width: `${spent * 100}%` }}
      />
      {committed > 0 && (
        <div
          className="h-full bg-foreground/30"
          style={{ width: `${committed * 100}%` }}
        />
      )}
    </div>
  );
}

function CappedRow({
  status,
  onOpen,
}: {
  status: FinanceEnvelopeStatus;
  onOpen: () => void;
}) {
  const allowance = status.limitMinor + status.carryInMinor;
  const share = allowance > 0 ? status.spentMinor / allowance : 0;
  const over = status.availableMinor < 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full border-b border-border/60 py-2.5 text-left last:border-b-0"
    >
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {status.name}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums">
          {money(status.spentMinor, status.currency)}
          <span className="text-muted-foreground">
            {" / "}
            {money(allowance, status.currency)}
          </span>
        </span>
        <span
          className={cn(
            "w-12 shrink-0 text-right text-[11px] tabular-nums",
            over ? "text-status-critical" : "text-muted-foreground",
          )}
        >
          {Math.round(share * 100)}%
        </span>
      </div>
      <div className="mt-1.5">
        <LimitBar
          spentShare={share}
          committedShare={allowance > 0 ? status.committedMinor / allowance : 0}
        />
      </div>
      <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-muted-foreground">
        <span className={cn(over && "text-status-critical")}>
          {over
            ? `${money(-status.availableMinor, status.currency)} over`
            : `${money(status.availableMinor, status.currency)} left`}
        </span>
        {status.carryInMinor !== 0 && (
          <span>{money(status.carryInMinor, status.currency)} carried</span>
        )}
        {status.committedMinor > 0 && (
          <span>{money(status.committedMinor, status.currency)} committed</span>
        )}
        {status.paceRatio !== null && status.paceRatio > 1.1 && (
          <span className="text-status-warning">
            {Math.round((status.paceRatio - 1) * 100)}% ahead of pace
          </span>
        )}
        <span className="ml-auto">
          {shortDay(status.periodStart)}–{shortDay(status.periodEnd)}
        </span>
      </div>
    </button>
  );
}

function SinkingRow({
  status,
  busy,
  onOpen,
  onContribute,
}: {
  status: FinanceEnvelopeStatus;
  busy: boolean;
  onOpen: () => void;
  onContribute: (amountMajor: number) => void;
}) {
  const [amount, setAmount] = useState("");
  const saved = status.savedMinor ?? 0;
  const share = status.limitMinor > 0 ? saved / status.limitMinor : 0;
  const required = status.requiredPerPeriodMinor ?? 0;

  return (
    <div className="border-b border-border/60 py-2.5 last:border-b-0">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-baseline gap-3 text-left"
      >
        <span className="min-w-0 flex-1 truncate text-[13px]">
          {status.name}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums">
          {money(saved, status.currency)}
          <span className="text-muted-foreground">
            {" / "}
            {money(status.limitMinor, status.currency)}
          </span>
        </span>
        <span className="w-12 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {Math.round(share * 100)}%
        </span>
      </button>
      <div className="mt-1.5">
        <LimitBar spentShare={share} committedShare={0} />
      </div>
      <div className="mt-1.5 flex items-center gap-2.5 text-[10px] text-muted-foreground">
        {required > 0 ? (
          <span
            className={cn(status.onTrack === false && "text-status-warning")}
          >
            {money(required, status.currency)} per {PERIOD_SHORT[status.period]}
            {status.periodsRemaining !== undefined &&
              ` × ${status.periodsRemaining}`}
          </span>
        ) : (
          <span className="text-status-good">Funded</span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Input
            inputMode="decimal"
            value={amount}
            aria-label={`Contribute to ${status.name}`}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="Add"
            className="h-6 w-20 px-2 text-[11px]"
          />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Record contribution"
            disabled={busy || !Number.isFinite(Number(amount)) || amount === ""}
            onClick={() => {
              onContribute(Number(amount));
              setAmount("");
            }}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Plus className="size-3" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SuggestionRow({
  suggestion,
  busy,
  refusal,
  onDecide,
}: {
  suggestion: FinanceBudgetSuggestion;
  busy: boolean;
  /** A 422: the suggestion is well-formed and the budget refused it. */
  refusal?: string;
  onDecide: (action: "apply" | "dismiss") => void;
}) {
  const applicable = suggestion.action.kind !== "advice";
  return (
    <div className="flex items-start gap-3 border-b border-border/60 py-2.5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-[13px] leading-tight">
            {suggestion.title}
          </span>
          {suggestion.impactMinor !== undefined &&
            suggestion.impactMinor !== 0 && (
              <span
                className={cn(
                  "shrink-0 text-[11px] tabular-nums",
                  suggestion.impactMinor > 0
                    ? "text-status-good"
                    : "text-status-warning",
                )}
              >
                {suggestion.impactMinor > 0 ? "+" : ""}
                {money(suggestion.impactMinor, suggestion.currency)}/mo
              </span>
            )}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
          {suggestion.rationale}
        </div>
        {/* A refusal outlives the toast that used to carry it: the reason a
            well-formed suggestion cannot be applied belongs next to the
            button that failed, not in something that disappears. */}
        {refusal && (
          <div className="mt-1.5 border-l-2 border-status-warning pl-2 text-[11px] leading-snug text-status-warning">
            {refusal}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {applicable && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy}
            onClick={() => onDecide("apply")}
          >
            {busy ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Check className="size-3" />
            )}
            Apply
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={busy}
          onClick={() => onDecide("dismiss")}
        >
          <X className="size-3" />
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function BudgetPageSkeleton() {
  return (
    <div className="space-y-8 p-4">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
        {["planned", "spent", "left", "projected", "loose"].map((key) => (
          <div key={key} className="space-y-2">
            <Skeleton className="h-2 w-14" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-2 w-20" />
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function FinanceBudgetPage() {
  const { client, slots, routes } = useAdmin();
  const router = useRouter();
  const [data, setData] = useState<FinanceBudgetOverview | null>(null);
  const [drafts, setDrafts] = useState<FinanceEnvelopeDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [coaching, setCoaching] = useState(false);
  // Keyed by suggestion: a refusal is about one suggestion and has to stay
  // beside it rather than replacing the previous one globally.
  const [refusals, setRefusals] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const [overview, envelopeDrafts] = await Promise.all([
        fetchFinanceBudget(client),
        fetchFinanceEnvelopeDrafts(client).catch(() => []),
      ]);
      setData(overview);
      setDrafts(envelopeDrafts);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Budget unavailable",
      );
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const { capped, sinking } = useMemo(() => {
    const statuses = data?.statuses ?? [];
    return {
      capped: statuses.filter((status) => status.kind === "capped"),
      sinking: statuses.filter((status) => status.kind === "sinking"),
    };
  }, [data]);

  async function withBusy(id: string, action: () => Promise<unknown>) {
    setBusyId(id);
    try {
      await action();
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  }

  const header = (
    <PageHeader
      leading={slots?.sidebarTrigger}
      icon={<Wallet className="size-4 text-muted-foreground" />}
      title="Budget"
    >
      <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
        <Link href={routes.finance.envelopeNew}>
          <Plus className="size-3.5" />
          Envelope
        </Link>
      </Button>
      <Button size="sm" variant="outline" className="h-8 text-xs" asChild>
        <Link href={routes.finance.root}>
          <ArrowLeft className="size-3.5" />
          Finance
        </Link>
      </Button>
    </PageHeader>
  );

  if (!data) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        {header}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <BudgetPageSkeleton />
          ) : (
            <div className="flex flex-col items-center gap-3 py-14">
              <p className="text-sm text-muted-foreground">
                {loadError ?? "Budget unavailable"}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLoading(true);
                  void load();
                }}
              >
                <RefreshCw className="size-3.5" />
                Retry
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { totals } = data;
  const overspending = totals.availableMinor < 0;
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-9 px-4 py-5">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
            <Figure
              label="Planned"
              value={money(totals.plannedMinor, totals.currency)}
              meta="per month"
            />
            <Figure
              label="Spent"
              value={money(totals.spentMinor, totals.currency)}
              meta={
                totals.committedMinor > 0
                  ? `+ ${money(totals.committedMinor, totals.currency)} committed`
                  : undefined
              }
            />
            <Figure
              label={overspending ? "Over" : "Left"}
              value={money(Math.abs(totals.availableMinor), totals.currency)}
              tone={overspending ? "critical" : undefined}
            />
            <Figure
              label="Projected"
              value={money(totals.projectedMinor, totals.currency)}
              tone={
                totals.projectedMinor > totals.plannedMinor
                  ? "critical"
                  : undefined
              }
              meta="month end"
            />
            <Figure
              label="Unbudgeted"
              value={money(totals.unbudgetedMinor, totals.currency)}
              meta={
                totals.incomeMinor > 0
                  ? `${money(totals.incomeMinor, totals.currency)} income`
                  : undefined
              }
            />
          </div>

          {data.unconvertedByCurrency.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Excluded, no rate:{" "}
              {data.unconvertedByCurrency
                .map((row) => money(row.amountMinor, row.currency))
                .join(", ")}
            </p>
          )}

          {/* Alerts get their own page — the transitions and the
              open/acknowledged/resolved split need room this summary has not
              got. What belongs here is the count and the worst one. */}
          <section className="space-y-1">
            <SectionHead label="Alerts">
              <Button variant="ghost" size="sm" asChild>
                <Link href={routes.finance.alerts}>
                  {openAlerts.length > 0
                    ? `${openAlerts.length} open`
                    : "None open"}
                </Link>
              </Button>
            </SectionHead>
            {openAlerts.length === 0 ? (
              <Empty label="—" compact />
            ) : (
              openAlerts.slice(0, 3).map((alert) => (
                <Link
                  key={alert.id}
                  href={routes.finance.alerts}
                  className="flex items-start gap-3 border-b border-border/60 py-2 last:border-b-0 hover:bg-muted/40"
                >
                  <StatusDot
                    tone={SEVERITY_TONE[alert.severity]}
                    label={alert.severity}
                    className="mt-1.5"
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {alert.title}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {relative(alert.firstSeenAt)}
                  </span>
                </Link>
              ))
            )}
          </section>

          <section className="space-y-1">
            <SectionHead label="Envelopes" />
            {capped.length === 0 ? (
              <Empty label="—" compact />
            ) : (
              capped.map((status) => (
                <CappedRow
                  key={status.envelopeId}
                  status={status}
                  onOpen={() =>
                    router.push(routes.finance.envelope(status.envelopeId))
                  }
                />
              ))
            )}
          </section>

          {sinking.length > 0 && (
            <section className="space-y-1">
              <SectionHead label="Funds" />
              {sinking.map((status) => (
                <SinkingRow
                  key={status.envelopeId}
                  status={status}
                  busy={busyId === status.envelopeId}
                  onOpen={() =>
                    router.push(routes.finance.envelope(status.envelopeId))
                  }
                  onContribute={(amountMajor) =>
                    withBusy(status.envelopeId, () =>
                      contributeToFinanceEnvelope(client, status.envelopeId, {
                        amountMinor: majorToMinor(amountMajor, status.currency),
                      }),
                    )
                  }
                />
              ))}
            </section>
          )}

          {data.unbudgeted.length > 0 && (
            <section className="space-y-1">
              <SectionHead label="Unbudgeted" />
              {data.unbudgeted.slice(0, 8).map((row) => {
                const label = row.category ?? "Uncategorized";
                const draft = drafts.find(
                  (entry) => entry.name === row.category,
                );
                return (
                  <div
                    key={label}
                    className="flex items-baseline gap-3 border-b border-border/60 py-2 last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {label}
                    </span>
                    <span className="shrink-0 text-[13px] tabular-nums">
                      {money(row.spentMinor, data.currency)}
                    </span>
                    <span className="w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                      {row.entryCount}{" "}
                      {row.entryCount === 1 ? "entry" : "entries"}
                    </span>
                    {row.category && (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={`${routes.finance.envelopeNew}?category=${encodeURIComponent(row.category)}&limit=${draft?.suggestedLimitMinor ?? row.spentMinor}`}
                        >
                          Budget
                        </Link>
                      </Button>
                    )}
                  </div>
                );
              })}
            </section>
          )}

          <section className="space-y-1">
            <SectionHead label="Coach">
              <Button
                variant="ghost"
                size="sm"
                aria-label="Ask the agent"
                onClick={() => window.dispatchEvent(new Event("agent:open"))}
              >
                <MessageCircle className="size-3" />
                Ask
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={coaching}
                onClick={async () => {
                  setCoaching(true);
                  try {
                    await generateFinanceBudgetSuggestions(client);
                    setRefusals({});
                    await load();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Review failed",
                    );
                  } finally {
                    setCoaching(false);
                  }
                }}
              >
                {coaching ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Sparkles className="size-3" />
                )}
                Review
              </Button>
            </SectionHead>
            {data.suggestions.length === 0 ? (
              <Empty label="—" compact />
            ) : (
              data.suggestions.map((suggestion) => (
                <SuggestionRow
                  key={suggestion.id}
                  suggestion={suggestion}
                  busy={busyId === suggestion.id}
                  refusal={refusals[suggestion.id]}
                  onDecide={async (action) => {
                    setBusyId(suggestion.id);
                    setRefusals((prev) => {
                      const next = { ...prev };
                      delete next[suggestion.id];
                      return next;
                    });
                    try {
                      await decideFinanceBudgetSuggestion(
                        client,
                        suggestion.id,
                        action,
                      );
                      await load();
                    } catch (error) {
                      const message =
                        error instanceof Error
                          ? error.message
                          : "Action failed";
                      // 422 means the budget refused a well-formed suggestion,
                      // which is information about the budget rather than a
                      // failure to report and forget.
                      if (
                        error instanceof AdminApiError &&
                        error.code === 422
                      ) {
                        setRefusals((prev) => ({
                          ...prev,
                          [suggestion.id]: message,
                        }));
                      } else {
                        toast.error(message);
                      }
                    } finally {
                      setBusyId(null);
                    }
                  }}
                />
              ))
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
