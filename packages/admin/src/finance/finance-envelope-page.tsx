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
import { StatusDot, type StatusTone } from "@repo/ui/status-dot";
import { cn } from "@repo/ui/utils";
import { Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { fetchFinanceBudget } from "./finance-budget-data";
import { EnvelopeForm } from "./finance-envelope-form";
import { Empty, Figure, relative, SectionHead } from "./finance-primitives";
import { money, shortDay } from "./finance-series";

const ICON = <Wallet className="size-4 text-muted-foreground" />;

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
  if (!rows.length) return <Empty label="—" compact />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] tabular-nums">
        <thead className="text-muted-foreground">
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
                <td className="py-1.5 text-right font-medium">
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

  const load = useCallback(async () => {
    setLoading(true);
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

  const seed: FinanceEnvelopeDraft | null = seedCategory
    ? {
        name: seedCategory,
        categories: [seedCategory],
        currency: baseCurrency,
        medianMinor: seedLimitMinor ?? 0,
        suggestedLimitMinor: seedLimitMinor ?? 0,
        period: "monthly",
        periodsObserved: 1,
      }
    : null;

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
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-5 xl:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-8">
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Figure
              label={status.kind === "sinking" ? "Target" : "Limit"}
              value={money(status.limitMinor, currency)}
              meta={`${shortDay(status.periodStart)} – ${shortDay(status.periodEnd)}`}
            />
            <Figure
              label="Spent"
              value={money(status.spentMinor, currency)}
              meta={
                status.refundedMinor > 0
                  ? `net of ${money(status.refundedMinor, currency)} refunded`
                  : `${status.entryCount} ${status.entryCount === 1 ? "entry" : "entries"}`
              }
            />
            <Figure
              label={overspent ? "Over" : "Left"}
              value={money(Math.abs(status.availableMinor), currency)}
              tone={overspent ? "critical" : undefined}
              meta={
                status.carryInMinor !== 0
                  ? `${money(status.carryInMinor, currency)} carried in`
                  : undefined
              }
            />
            <Figure
              label="Projected"
              value={money(status.projectedMinor, currency)}
              tone={
                status.projectedMinor > status.limitMinor
                  ? "critical"
                  : undefined
              }
              meta={
                status.paceRatio === null
                  ? undefined
                  : `${status.paceRatio.toFixed(2)}× pace`
              }
            />
          </div>

          <section className="space-y-2">
            <SectionHead label="Rollover" />
            {detail.envelope.rollover === "none" ? (
              <Empty label="Resets each period" compact />
            ) : (
              <RolloverTable rows={detail.rollover} currency={currency} />
            )}
          </section>

          <section className="space-y-1">
            <SectionHead label="This period" />
            {detail.entries.length === 0 ? (
              <Empty label="—" compact />
            ) : (
              detail.entries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-baseline gap-3 border-b border-border/60 py-2 last:border-b-0"
                >
                  <span className="w-14 shrink-0 text-[11px] tabular-nums text-muted-foreground">
                    {shortDay(entry.effectiveDate)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[13px]">
                    {entry.descriptor}
                  </span>
                  {entry.origin === "projected" && (
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">
                      committed
                    </span>
                  )}
                  <span
                    className={cn(
                      "shrink-0 text-[13px] tabular-nums",
                      entry.amountMinor > 0 && "text-status-good",
                    )}
                  >
                    {money(entry.amountMinor, entry.currency)}
                  </span>
                </div>
              ))
            )}
          </section>

          <section className="space-y-1">
            <SectionHead label="Alerts" />
            {detail.alerts.length === 0 ? (
              <Empty label="—" compact />
            ) : (
              detail.alerts.map((alert) => (
                <div
                  key={alert.id}
                  className="flex items-start gap-3 border-b border-border/60 py-2 last:border-b-0"
                >
                  <StatusDot
                    tone={SEVERITY_TONE[alert.severity]}
                    label={alert.severity}
                    className="mt-1.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{alert.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {alert.detail}
                    </div>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {alert.status} · {relative(alert.lastSeenAt)}
                  </span>
                </div>
              ))
            )}
          </section>
        </div>

        <div className="min-w-0">
          <SectionHead label="Settings" />
          <div className="mt-3">{form}</div>
        </div>
      </div>
    </DetailPageShell>
  );
}
