"use client";

import type {
  FinanceBudgetOverview,
  FinanceBudgetSuggestion,
  FinanceEnvelopeDraft,
  FinanceEnvelopeStatus,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { majorToMinor } from "@repo/utils";
import {
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
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
import { relative } from "./finance-primitives";
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

const ROW =
  "group/row -mx-2 flex w-[calc(100%+1rem)] flex-col gap-1.5 rounded-md px-2 py-2.5 text-left transition-colors";

function withQueryParams(base: string, params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return `${base}${base.includes("?") ? "&" : "?"}${query}`;
}

/**
 * A limit bar that can exceed its track.
 *
 * Overspend is drawn as a distinct overflow segment rather than a bar clamped
 * at 100%: the whole point of the row is to show by how much, and a full bar
 * reads identically at 101% and 300%.
 */
export function LimitBar({
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
    <div className="flex h-1 w-full overflow-hidden rounded-full bg-border">
      <div
        className={cn(
          "h-full",
          over > 0 ? "bg-status-critical" : "bg-accent-strong/70",
        )}
        style={{ width: `${spent * 100}%` }}
      />
      {committed > 0 && (
        <div
          className="h-full bg-accent-strong/25"
          style={{ width: `${committed * 100}%` }}
        />
      )}
    </div>
  );
}

function RowFigures({
  name,
  value,
  of,
  share,
  tone,
}: {
  name: string;
  value: string;
  of: string;
  share: number;
  tone?: "critical";
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="min-w-0 flex-1 truncate text-sm text-accent-strong">
        {name}
      </span>
      <span className="shrink-0 text-sm tabular-nums text-accent-strong">
        {value}
        <span className="text-muted-foreground"> / {of}</span>
      </span>
      <span
        className={cn(
          "w-12 shrink-0 text-right text-xs tabular-nums",
          tone === "critical"
            ? "text-status-critical"
            : "text-muted-foreground",
        )}
      >
        {Math.round(share * 100)}%
      </span>
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
      className={cn(
        ROW,
        "hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none",
      )}
    >
      <RowFigures
        name={status.name}
        value={money(status.spentMinor, status.currency)}
        of={money(allowance, status.currency)}
        share={share}
        tone={over ? "critical" : undefined}
      />
      <LimitBar
        spentShare={share}
        committedShare={allowance > 0 ? status.committedMinor / allowance : 0}
      />
      <div className="flex w-full items-center gap-2.5 text-[11px] tabular-nums text-muted-foreground">
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
  const value = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(value) && value !== 0;

  return (
    <div role="listitem" className={ROW}>
      <button
        type="button"
        onClick={onOpen}
        className="-mx-2 -my-1 rounded-md px-2 py-1 text-left transition-colors hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none"
      >
        <RowFigures
          name={status.name}
          value={money(saved, status.currency)}
          of={money(status.limitMinor, status.currency)}
          share={share}
        />
      </button>
      <LimitBar spentShare={share} committedShare={0} />
      <form
        className="flex items-center gap-2.5 text-[11px] tabular-nums text-muted-foreground"
        onSubmit={(event) => {
          event.preventDefault();
          if (!valid || busy) return;
          onContribute(value);
          setAmount("");
        }}
      >
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
        <div className="ml-auto flex items-center gap-1">
          <Input
            inputMode="decimal"
            value={amount}
            aria-label={`Contribute to ${status.name}`}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={status.currency}
            className="h-7 w-24 text-right text-xs tabular-nums"
          />
          <Button
            type="submit"
            variant="ghost"
            size="icon-sm"
            aria-label="Record contribution"
            disabled={busy || !valid}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Plus />}
          </Button>
        </div>
      </form>
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
    <div role="listitem" className="flex items-start gap-3 py-2.5">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm leading-tight text-accent-strong">
            {suggestion.title}
          </span>
          {suggestion.impactMinor !== undefined &&
            suggestion.impactMinor !== 0 && (
              <span
                className={cn(
                  "shrink-0 text-xs tabular-nums",
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
        <div className="text-xs leading-snug text-muted-foreground">
          {suggestion.rationale}
        </div>
        {/* A refusal outlives the toast that used to carry it: the reason a
            well-formed suggestion cannot be applied belongs next to the
            button that failed, not in something that disappears. */}
        {refusal && (
          <div className="mt-1 border-l-2 border-status-warning pl-2 text-xs leading-snug text-status-warning">
            {refusal}
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {applicable && (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onDecide("apply")}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            Apply
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => onDecide("dismiss")}
        >
          <X />
          Dismiss
        </Button>
      </div>
    </div>
  );
}

export function BudgetPageSkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-6 sm:grid-cols-5">
        {["planned", "spent", "left", "projected", "loose"].map((key) => (
          <div key={key} className="flex flex-col gap-2">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-6 w-20" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-2.5 w-20" />
        {["a", "b", "c"].map((key) => (
          <Skeleton key={key} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}

export function FinanceBudgetPage({
  embedded = false,
  onOpenAlerts,
}: {
  embedded?: boolean;
  onOpenAlerts?: () => void;
}) {
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

  async function coach() {
    setCoaching(true);
    try {
      await generateFinanceBudgetSuggestions(client);
      setRefusals({});
      await load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Review failed");
    } finally {
      setCoaching(false);
    }
  }

  async function decide(
    suggestion: FinanceBudgetSuggestion,
    action: "apply" | "dismiss",
  ) {
    setBusyId(suggestion.id);
    setRefusals((prev) => {
      const next = { ...prev };
      delete next[suggestion.id];
      return next;
    });
    try {
      await decideFinanceBudgetSuggestion(client, suggestion.id, action);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action failed";
      // 422 means the budget refused a well-formed suggestion, which is
      // information about the budget rather than a failure to report and forget.
      if (error instanceof AdminApiError && error.code === 422) {
        setRefusals((prev) => ({ ...prev, [suggestion.id]: message }));
      } else {
        toast.error(message);
      }
    } finally {
      setBusyId(null);
    }
  }

  const newEnvelope = (
    <Button size="sm" variant={embedded ? "ghost" : "default"} asChild>
      <Link href={routes.finance.envelopeNew}>
        <Plus />
        Envelope
      </Link>
    </Button>
  );

  function frame(body: ReactNode) {
    if (embedded) return body;
    return (
      <Page>
        <PageHeader
          leading={slots?.sidebarTrigger}
          crumbs={[
            {
              label: "Finance",
              onClick: () => router.push(routes.finance.root),
            },
          ]}
          icon={<Wallet />}
          title="Budget"
        >
          {newEnvelope}
        </PageHeader>
        <PageBody>{body}</PageBody>
      </Page>
    );
  }

  if (!data) {
    return frame(
      loading ? (
        <BudgetPageSkeleton />
      ) : (
        <EmptyState
          icon={<Wallet />}
          label={loadError ?? "Budget unavailable"}
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLoading(true);
                void load();
              }}
            >
              <RefreshCw />
              Retry
            </Button>
          }
        />
      ),
    );
  }

  const { totals } = data;
  const overspending = totals.availableMinor < 0;
  const openAlerts = data.alerts.filter((alert) => alert.status === "open");
  const alertsLabel =
    openAlerts.length > 0 ? `${openAlerts.length} open` : "None open";

  return frame(
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <StatGroup>
          <Stat
            label="Planned"
            value={money(totals.plannedMinor, totals.currency)}
            hint="per month"
          />
          <Stat
            label="Spent"
            value={money(totals.spentMinor, totals.currency)}
            hint={
              totals.committedMinor > 0
                ? `+ ${money(totals.committedMinor, totals.currency)} committed`
                : undefined
            }
          />
          <Stat
            label={overspending ? "Over" : "Left"}
            value={money(Math.abs(totals.availableMinor), totals.currency)}
            tone={overspending ? "critical" : "default"}
          />
          <Stat
            label="Projected"
            value={money(totals.projectedMinor, totals.currency)}
            tone={
              totals.projectedMinor > totals.plannedMinor
                ? "critical"
                : "default"
            }
            hint="month end"
          />
          <Stat
            label="Unbudgeted"
            value={money(totals.unbudgetedMinor, totals.currency)}
            hint={
              totals.incomeMinor > 0
                ? `${money(totals.incomeMinor, totals.currency)} income`
                : undefined
            }
          />
        </StatGroup>
        {data.unconvertedByCurrency.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Excluded, no rate:{" "}
            {data.unconvertedByCurrency
              .map((row) => money(row.amountMinor, row.currency))
              .join(", ")}
          </p>
        )}
      </div>

      <Section
        title="Alerts"
        count={openAlerts.length}
        actions={
          embedded && onOpenAlerts ? (
            <Button variant="ghost" size="sm" onClick={onOpenAlerts}>
              {alertsLabel}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" asChild>
              <Link href={routes.finance.alerts}>{alertsLabel}</Link>
            </Button>
          )
        }
      >
        {openAlerts.length === 0 ? (
          <EmptyState compact label="No open alerts" />
        ) : (
          <List divided>
            {openAlerts.slice(0, 3).map((alert) => {
              const row = (
                <ListRow
                  key={alert.id}
                  onClick={embedded && onOpenAlerts ? onOpenAlerts : undefined}
                  leading={
                    <StatusDot
                      tone={SEVERITY_TONE[alert.severity]}
                      label={alert.severity}
                    />
                  }
                  title={alert.title}
                  meta={relative(alert.firstSeenAt)}
                />
              );
              return embedded && onOpenAlerts ? (
                row
              ) : (
                <Link key={alert.id} href={routes.finance.alerts}>
                  {row}
                </Link>
              );
            })}
          </List>
        )}
      </Section>

      <Section
        title="Envelopes"
        count={capped.length}
        actions={embedded ? newEnvelope : undefined}
      >
        {capped.length === 0 ? (
          <EmptyState compact icon={<Wallet />} label="No envelopes" />
        ) : (
          <List divided>
            {capped.map((status) => (
              <CappedRow
                key={status.envelopeId}
                status={status}
                onOpen={() =>
                  router.push(routes.finance.envelope(status.envelopeId))
                }
              />
            ))}
          </List>
        )}
      </Section>

      {sinking.length > 0 && (
        <Section title="Funds" count={sinking.length}>
          <List divided>
            {sinking.map((status) => (
              <SinkingRow
                key={status.envelopeId}
                status={status}
                busy={busyId === status.envelopeId}
                onOpen={() =>
                  router.push(routes.finance.envelope(status.envelopeId))
                }
                onContribute={(amountMajor) =>
                  void withBusy(status.envelopeId, () =>
                    contributeToFinanceEnvelope(client, status.envelopeId, {
                      amountMinor: majorToMinor(amountMajor, status.currency),
                    }),
                  )
                }
              />
            ))}
          </List>
        </Section>
      )}

      {data.unbudgeted.length > 0 && (
        <Section title="Unbudgeted" count={data.unbudgeted.length}>
          <List divided>
            {data.unbudgeted.slice(0, 8).map((row) => {
              const label = row.category ?? "Uncategorized";
              const draft = drafts.find((entry) => entry.name === row.category);
              return (
                <ListRow
                  key={label}
                  title={label}
                  meta={
                    <>
                      <span className="text-sm text-accent-strong">
                        {money(row.spentMinor, data.currency)}
                      </span>
                      <span className="w-16 text-right">
                        {row.entryCount}{" "}
                        {row.entryCount === 1 ? "entry" : "entries"}
                      </span>
                    </>
                  }
                  trailing={
                    row.category ? (
                      <Button variant="ghost" size="sm" asChild>
                        <Link
                          href={withQueryParams(routes.finance.envelopeNew, {
                            category: row.category,
                            limit: String(
                              draft?.suggestedLimitMinor ?? row.spentMinor,
                            ),
                          })}
                        >
                          Budget
                        </Link>
                      </Button>
                    ) : (
                      <span className="w-[4.25rem]" />
                    )
                  }
                />
              );
            })}
          </List>
        </Section>
      )}

      <Section
        title="Coach"
        count={data.suggestions.length}
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.dispatchEvent(new Event("agent:open"))}
            >
              <MessageCircle />
              Ask
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={coaching}
              onClick={() => void coach()}
            >
              {coaching ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Review
            </Button>
          </>
        }
      >
        {data.suggestions.length === 0 ? (
          <EmptyState compact label="No suggestions" />
        ) : (
          <List divided>
            {data.suggestions.map((suggestion) => (
              <SuggestionRow
                key={suggestion.id}
                suggestion={suggestion}
                busy={busyId === suggestion.id}
                refusal={refusals[suggestion.id]}
                onDecide={(action) => void decide(suggestion, action)}
              />
            ))}
          </List>
        )}
      </Section>
    </div>,
  );
}
