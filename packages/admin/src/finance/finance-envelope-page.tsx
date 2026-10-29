"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceDashboardResponse,
  FinanceEnvelope,
  FinanceEnvelopeDetail,
  FinanceEnvelopeDraft,
  FinanceRolloverPeriod,
} from "@repo/schemas";
import { financeEnvelopeDetailSchema } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { EmptyState } from "@repo/ui/empty-state";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Stat, StatGroup } from "@repo/ui/stat";
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { fetchFinanceBudget } from "./finance-budget-data";
import { EnvelopeForm } from "./finance-envelope-form";
import { relative } from "./finance-primitives";
import { money, shortDay } from "./finance-series";

const ICON = <Wallet />;

const SEVERITY_TONE: Record<"info" | "warning" | "critical", StatusTone> = {
  info: "muted",
  warning: "warning",
  critical: "critical",
};

/**
 * The rollover walk-back, period by period.
 *
 * The carried balance is derived from the ledger every time it is asked for
 * rather than stored, so the only way to check it is to see the walk that
 * produced it. `remaining` and `carry out` differ exactly where a `surplus`
 * envelope absorbed an overspend, which is the rule that is otherwise
 * invisible.
 */
function RolloverTable({
  rows,
  currency,
}: {
  rows: FinanceRolloverPeriod[];
  currency: string;
}) {
  if (!rows.length) return <EmptyState compact label="No periods" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs tabular-nums">
        <thead className="text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
          <tr className="border-b">
            <th className="py-1.5 text-left font-medium">Period</th>
            <th className="py-1.5 text-right font-medium">Carried in</th>
            <th className="py-1.5 text-right font-medium">Limit</th>
            <th className="py-1.5 text-right font-medium">Spent</th>
            <th className="py-1.5 text-right font-medium">Remaining</th>
            <th className="py-1.5 text-right font-medium">Carried out</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const absorbed = row.remainingMinor !== row.carryOutMinor;
            return (
              <tr key={row.periodStart} className="border-b border-border/60">
                <td className="py-1.5">
                  {shortDay(row.periodStart)} – {shortDay(row.periodEnd)}
                </td>
                <td className="py-1.5 text-right">
                  {money(row.carryInMinor, currency)}
                </td>
                <td className="py-1.5 text-right text-muted-foreground">
                  {money(row.limitMinor, currency)}
                </td>
                <td className="py-1.5 text-right">
                  {money(row.spentMinor, currency)}
                </td>
                <td
                  className={cn(
                    "py-1.5 text-right",
                    row.remainingMinor < 0 && "text-status-critical",
                  )}
                >
                  {money(row.remainingMinor, currency)}
                </td>
                <td className="py-1.5 text-right font-medium text-accent-strong">
                  {money(row.carryOutMinor, currency)}
                  {absorbed && (
                    <span
                      className="ml-1 text-muted-foreground"
                      title="Overspend absorbed rather than carried"
                    >
                      ·
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function FinanceEnvelopePage({
  envelopeId,
  seedCategory,
  seedLimitMinor,
}: {
  /** Absent creates a new envelope. */
  envelopeId?: string;
  /** Pre-fill for the "budget this category" flow on the overview. */
  seedCategory?: string;
  seedLimitMinor?: number;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.finance.budget;
  const mode = envelopeId ? "edit" : "create";

  const [detail, setDetail] = useState<FinanceEnvelopeDetail | null>(null);
  const [envelopes, setEnvelopes] = useState<FinanceEnvelope[]>([]);
  const [accounts, setAccounts] = useState<FinanceAccount[]>([]);
  const [categories, setCategories] = useState<FinanceCategory[]>([]);
  const [baseCurrency, setBaseCurrency] = useState("EUR");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  // Only the first load shows the skeleton: a reload after saving would
  // otherwise unmount the form mid-session.
  const load = useCallback(async () => {
    try {
      // The form needs every other envelope to know which categories are
      // already claimed, and the account and category pickers come from the
      // dashboard — there is no narrower endpoint that carries both.
      const [overview, dashboard] = await Promise.all([
        fetchFinanceBudget(client),
        client.get<FinanceDashboardResponse>("finance"),
      ]);
      setEnvelopes(overview.envelopes);
      setBaseCurrency(overview.currency);
      setAccounts(dashboard.accounts);
      setCategories(dashboard.categories);

      if (envelopeId) {
        const response = await client.get<unknown>(
          `finance/envelopes/${encodeURIComponent(envelopeId)}`,
        );
        setDetail(financeEnvelopeDetailSchema.parse(response));
        setNotFound(false);
      }
    } catch {
      if (envelopeId) setNotFound(true);
      else toast.error("Failed to load budget");
    } finally {
      setLoading(false);
    }
  }, [client, envelopeId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Memoized: the form resets its draft whenever the seed's identity changes.
  const seed = useMemo<FinanceEnvelopeDraft | null>(
    () =>
      seedCategory
        ? {
            name: seedCategory,
            categories: [seedCategory],
            currency: baseCurrency,
            medianMinor: seedLimitMinor ?? 0,
            suggestedLimitMinor: seedLimitMinor ?? 0,
            period: "monthly",
            periodsObserved: 1,
          }
        : null,
    [seedCategory, seedLimitMinor, baseCurrency],
  );

  const shell = { icon: ICON, backTo, backLabel: "Budget" } as const;

  if (loading) {
    return <DetailPageSkeleton {...shell} title="Envelope" rows={2} />;
  }

  if (mode === "edit" && (notFound || !detail)) {
    return (
      <DetailNotFound
        {...shell}
        title="Envelope not found"
        message="This envelope could not be loaded."
      />
    );
  }

  const form = (
    <EnvelopeForm
      envelope={detail?.envelope}
      seed={seed}
      envelopes={envelopes}
      accounts={accounts}
      categories={categories}
      baseCurrency={baseCurrency}
      onSaved={(saved) => {
        if (mode === "create") router.push(routes.finance.envelope(saved.id));
        else void load();
      }}
      onDeleted={() => router.push(backTo)}
      onCancel={() => router.push(backTo)}
    />
  );

  if (mode === "create" || !detail) {
    return (
      <DetailPageShell {...shell} title="New envelope">
        {form}
      </DetailPageShell>
    );
  }

  const { status, currency } = detail;
  const overspent = status.availableMinor < 0;

  return (
    <DetailPageShell {...shell} title={detail.envelope.name} contained={false}>
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-5 py-6 sm:px-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-8">
          <StatGroup>
            <Stat
              label={status.kind === "sinking" ? "Target" : "Limit"}
              value={money(status.limitMinor, currency)}
              hint={`${shortDay(status.periodStart)} – ${shortDay(status.periodEnd)}`}
            />
            <Stat
              label="Spent"
              value={money(status.spentMinor, currency)}
              hint={
                status.refundedMinor > 0
                  ? `net of ${money(status.refundedMinor, currency)} refunded`
                  : `${status.entryCount} ${status.entryCount === 1 ? "entry" : "entries"}`
              }
            />
            <Stat
              label={overspent ? "Over" : "Left"}
              value={money(Math.abs(status.availableMinor), currency)}
              tone={overspent ? "critical" : "default"}
              hint={
                status.carryInMinor !== 0
                  ? `${money(status.carryInMinor, currency)} carried in`
                  : undefined
              }
            />
            <Stat
              label="Projected"
              value={money(status.projectedMinor, currency)}
              tone={
                status.projectedMinor > status.limitMinor
                  ? "critical"
                  : "default"
              }
              hint={
                status.paceRatio === null
                  ? undefined
                  : `${status.paceRatio.toFixed(2)}× pace`
              }
            />
          </StatGroup>

          <Section title="Rollover">
            {detail.envelope.rollover === "none" ? (
              <EmptyState compact label="Resets each period" />
            ) : (
              <RolloverTable rows={detail.rollover} currency={currency} />
            )}
          </Section>

          <Section title="This period" count={detail.entries.length}>
            {detail.entries.length === 0 ? (
              <EmptyState compact label="No entries" />
            ) : (
              <List divided>
                {detail.entries.map((entry) => (
                  <Link key={entry.id} href={routes.finance.entry(entry.id)}>
                    <ListRow
                      title={entry.descriptor}
                      description={shortDay(entry.effectiveDate)}
                      meta={
                        <>
                          {entry.origin === "projected" && (
                            <Badge variant="outline">committed</Badge>
                          )}
                          <span
                            className={cn(
                              "text-sm",
                              entry.amountMinor > 0
                                ? "text-status-good"
                                : "text-accent-strong",
                            )}
                          >
                            {money(entry.amountMinor, entry.currency)}
                          </span>
                        </>
                      }
                    />
                  </Link>
                ))}
              </List>
            )}
          </Section>

          <Section title="Alerts" count={detail.alerts.length}>
            {detail.alerts.length === 0 ? (
              <EmptyState compact label="No alerts" />
            ) : (
              <List divided>
                {detail.alerts.map((alert) => (
                  <ListRow
                    key={alert.id}
                    leading={
                      <StatusDot
                        tone={SEVERITY_TONE[alert.severity]}
                        label={alert.severity}
                      />
                    }
                    title={alert.title}
                    description={alert.detail}
                    meta={`${alert.status} · ${relative(alert.lastSeenAt)}`}
                  />
                ))}
              </List>
            )}
          </Section>
        </div>

        <Section title="Settings" className="min-w-0">
          {form}
        </Section>
      </div>
    </DetailPageShell>
  );
}
