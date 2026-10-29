"use client";

import type {
  FinancePayoutPeriod,
  FinancePayoutScheduleResponse,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { List, ListRow } from "@repo/ui/list";
import { NumericField } from "@repo/ui/numeric-field";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { formatMinutes, majorToMinor, minorToMajor } from "@repo/utils";
import { ChevronDown, Link2, Loader2 } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { fetchFinancePayouts, setFinancePayoutOverride } from "./finance-data";
import { money, shortDay } from "./finance-series";

const PHASE_VARIANT: Record<
  FinancePayoutPeriod["phase"],
  "outline" | "info" | "warning" | "good"
> = {
  upcoming: "outline",
  open: "info",
  closed: "warning",
  paid: "good",
};

function hoursInput(minutes: number | undefined) {
  return minutes === undefined
    ? ""
    : String(Math.round((minutes / 60) * 100) / 100);
}

function moneyInput(minor: number | undefined, currency: string) {
  return minor === undefined ? "" : String(minorToMajor(minor, currency));
}

function OverrideEditor({
  ruleId,
  period,
  onSaved,
}: {
  ruleId: string;
  period: FinancePayoutPeriod;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const override = period.override;
  const [hours, setHours] = useState(hoursInput(override?.workedMinutes));
  const [gross, setGross] = useState(
    moneyInput(override?.grossMinor, period.currency),
  );
  const [net, setNet] = useState(
    moneyInput(override?.netMinor, period.currency),
  );
  const [saving, setSaving] = useState(false);

  async function save(clear = false) {
    setSaving(true);
    try {
      const parse = (value: string) =>
        value.trim() === "" ? null : Number(value);
      const hoursValue = parse(hours);
      const grossValue = parse(gross);
      const netValue = parse(net);
      await setFinancePayoutOverride(
        client,
        ruleId,
        period.payoutDate,
        clear
          ? null
          : {
              workedMinutes:
                hoursValue === null ? null : Math.round(hoursValue * 60),
              grossMinor:
                grossValue === null
                  ? null
                  : majorToMinor(grossValue, period.currency),
              netMinor:
                netValue === null
                  ? null
                  : majorToMinor(netValue, period.currency),
            },
      );
      if (clear) {
        setHours("");
        setGross("");
        setNet("");
      }
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Override failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <FormGrid className="sm:grid-cols-3">
        <FormField label="Hours">
          <NumericField
            value={hours}
            onValueChange={(value) => setHours(value)}
            placeholder={hoursInput(period.projectedMinutes)}
            className="text-right tabular-nums"
          />
        </FormField>
        <FormField label="Gross">
          <NumericField
            value={gross}
            onValueChange={(value) => setGross(value)}
            placeholder={moneyInput(period.grossMinor, period.currency)}
            className="text-right tabular-nums"
          />
        </FormField>
        <FormField label="Net">
          <NumericField
            value={net}
            onValueChange={(value) => setNet(value)}
            placeholder={moneyInput(period.netMinor, period.currency)}
            className="text-right tabular-nums"
          />
        </FormField>
      </FormGrid>
      <div className="flex justify-end gap-2">
        {override && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Clear
          </Button>
        )}
        <Button type="submit" size="sm" variant="outline" disabled={saving}>
          {saving && <Loader2 className="animate-spin" />}
          Override
        </Button>
      </div>
    </form>
  );
}

function BreakdownLine({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-between gap-3", className)}>
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span className="shrink-0 text-accent-strong">{value}</span>
    </div>
  );
}

function PeriodRow({
  ruleId,
  period,
  onSaved,
}: {
  ruleId: string;
  period: FinancePayoutPeriod;
  onSaved: () => Promise<void>;
}) {
  const { routes } = useAdmin();
  const [open, setOpen] = useState(false);
  // A bank row may be in another currency than the payout (a DKK job paid
  // into a EUR account), so the shown figure carries its own.
  const shown = period.actual ?? {
    amountMinor: period.netMinor,
    currency: period.currency,
  };
  const comparableActual =
    period.actual && period.actual.currency === period.currency
      ? period.actual
      : undefined;

  return (
    <div role="listitem" className="flex flex-col">
      <ListRow
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title={
          <span className="flex items-center gap-2">
            <span className="tabular-nums">{shortDay(period.payoutDate)}</span>
            <Badge variant={PHASE_VARIANT[period.phase]}>{period.phase}</Badge>
            {period.partial && <Badge variant="outline">partial</Badge>}
            {period.override && <Badge variant="outline">edited</Badge>}
          </span>
        }
        description={
          <span className="tabular-nums">
            {shortDay(period.periodStart)} – {shortDay(period.periodEnd)} ·{" "}
            {formatMinutes(period.loggedMinutes)}
            {period.projectedMinutes !== period.loggedMinutes &&
              ` → ${formatMinutes(period.projectedMinutes)}`}{" "}
            h · gross {money(period.grossMinor, period.currency)}
          </span>
        }
        meta={
          <span className="flex flex-col items-end">
            <span
              className={cn(
                "text-sm font-medium",
                period.actual ? "text-status-good" : "text-accent-strong",
              )}
            >
              {money(shown.amountMinor, shown.currency)}
            </span>
            {period.varianceMinor !== undefined &&
            period.varianceMinor !== 0 ? (
              <span
                className={cn(
                  "text-[11px]",
                  period.varianceMinor < 0
                    ? "text-status-critical"
                    : "text-status-good",
                )}
              >
                {period.varianceMinor > 0 ? "+" : ""}
                {money(period.varianceMinor, period.currency)}
              </span>
            ) : (
              !period.actual && <span className="text-[11px]">est.</span>
            )}
          </span>
        }
        trailing={
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        }
      />

      {open && (
        <div className="mb-3 ml-1 mt-1 flex flex-col gap-4 border-l pl-4">
          <div className="flex flex-col gap-1 text-xs tabular-nums">
            <BreakdownLine
              label={`Gross${
                period.hourlyRateMinor !== undefined
                  ? ` · ${formatMinutes(period.projectedMinutes)} × ${money(period.hourlyRateMinor, period.currency)}`
                  : ""
              }`}
              value={money(period.grossMinor, period.currency)}
            />
            {period.lines.map((line) => (
              <BreakdownLine
                key={line.lineId}
                label={`${line.name} on ${money(line.baseMinor, period.currency)}`}
                value={`−${money(line.amountMinor, period.currency)}`}
              />
            ))}
            <BreakdownLine
              className="border-t pt-1 font-medium"
              label={`Net${period.override?.netMinor !== undefined ? " (set)" : ""}`}
              value={money(period.netMinor, period.currency)}
            />
            {period.actual && (
              <BreakdownLine
                label={`${shortDay(period.actual.effectiveDate)} · ${period.actual.descriptor}`}
                value={
                  <span className="text-status-good">
                    {money(period.actual.amountMinor, period.actual.currency)}
                  </span>
                }
              />
            )}
            {comparableActual && period.grossMinor > 0 && (
              <BreakdownLine
                label="Effective deduction"
                value={`${
                  Math.round(
                    (1 - comparableActual.amountMinor / period.grossMinor) *
                      1000,
                  ) / 10
                }%`}
              />
            )}
          </div>

          <OverrideEditor ruleId={ruleId} period={period} onSaved={onSaved} />

          {period.projectedLedgerId && (
            <Button asChild size="sm" variant="ghost" className="self-start">
              <Link href={routes.finance.entry(period.projectedLedgerId)}>
                <Link2 />
                {period.actual ? "Ledger entry" : "Reconcile"}
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Every payout of a payout rule, newest first: the hours behind it, the
 * deduction breakdown, the bank row it reconciled against and the override
 * controls. Shared by the Finance rule page and the hours app.
 */
export function FinancePayoutSchedule({
  ruleId,
  limit,
  /** Bumped by the host to force a reload, e.g. after a clock-out. */
  refreshKey,
}: {
  ruleId: string;
  limit?: number;
  refreshKey?: unknown;
}) {
  const { client } = useAdmin();
  const [data, setData] = useState<FinancePayoutScheduleResponse | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchFinancePayouts(client, ruleId));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Payouts failed");
    }
  }, [client, ruleId]);

  useEffect(() => {
    void refreshKey;
    void load();
  }, [load, refreshKey]);

  if (!data) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  const periods = limit ? data.periods.slice(0, limit) : data.periods;
  if (periods.length === 0) return <EmptyState compact label="No payouts" />;

  return (
    <List divided>
      {periods.map((period) => (
        <PeriodRow
          key={period.payoutDate}
          ruleId={ruleId}
          period={period}
          onSaved={load}
        />
      ))}
    </List>
  );
}
