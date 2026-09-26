"use client";

import type {
  FinancePayoutPeriod,
  FinancePayoutScheduleResponse,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { NumericField } from "@repo/ui/numeric-field";
import { Skeleton } from "@repo/ui/skeleton";
import { cn } from "@repo/ui/utils";
import { formatMinutes, majorToMinor, minorToMajor } from "@repo/utils";
import { ChevronDown, Link2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { fetchFinancePayouts, setFinancePayoutOverride } from "./finance-data";
import { Empty, FieldRow } from "./finance-primitives";
import { money, shortDay } from "./finance-series";

const PHASE_LABEL: Record<FinancePayoutPeriod["phase"], string> = {
  upcoming: "upcoming",
  open: "open",
  closed: "closed",
  paid: "paid",
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
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <FieldRow label="Hours">
          <NumericField
            value={hours}
            onValueChange={(value) => setHours(value)}
            placeholder={hoursInput(period.projectedMinutes)}
            className="h-8 text-right text-xs tabular-nums"
          />
        </FieldRow>
        <FieldRow label="Gross">
          <NumericField
            value={gross}
            onValueChange={(value) => setGross(value)}
            placeholder={moneyInput(period.grossMinor, period.currency)}
            className="h-8 text-right text-xs tabular-nums"
          />
        </FieldRow>
        <FieldRow label="Net">
          <NumericField
            value={net}
            onValueChange={(value) => setNet(value)}
            placeholder={moneyInput(period.netMinor, period.currency)}
            className="h-8 text-right text-xs tabular-nums"
          />
        </FieldRow>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          className="flex-1"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          Override
        </Button>
        {override && (
          <Button
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void save(true)}
          >
            Clear
          </Button>
        )}
      </div>
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
  const shown = period.actual?.amountMinor ?? period.netMinor;

  return (
    <div className="py-2.5">
      <button
        type="button"
        className="flex w-full min-w-0 items-center gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="tabular-nums">{shortDay(period.payoutDate)}</span>
            <Badge
              variant={period.phase === "paid" ? "secondary" : "outline"}
              className="h-4 px-1.5 text-[10px]"
            >
              {PHASE_LABEL[period.phase]}
            </Badge>
            {period.partial && (
              <span className="text-[10px] text-muted-foreground">partial</span>
            )}
            {period.override && (
              <span className="text-[10px] text-muted-foreground">edited</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11px] tabular-nums text-muted-foreground">
            {shortDay(period.periodStart)} – {shortDay(period.periodEnd)} ·{" "}
            {formatMinutes(period.loggedMinutes)}
            {period.projectedMinutes !== period.loggedMinutes &&
              ` → ${formatMinutes(period.projectedMinutes)}`}{" "}
            h · gross {money(period.grossMinor, period.currency)}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              "text-sm font-medium tabular-nums",
              period.actual && "text-status-good",
            )}
          >
            {money(shown, period.currency)}
          </div>
          {period.varianceMinor !== undefined && period.varianceMinor !== 0 ? (
            <div
              className={cn(
                "text-[10px] tabular-nums",
                period.varianceMinor < 0
                  ? "text-status-critical"
                  : "text-status-good",
              )}
            >
              {period.varianceMinor > 0 ? "+" : ""}
              {money(period.varianceMinor, period.currency)}
            </div>
          ) : (
            !period.actual && (
              <div className="text-[10px] text-muted-foreground">est.</div>
            )
          )}
        </div>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-4 border-l pl-3">
          <div className="space-y-1 text-xs tabular-nums">
            <div className="flex justify-between">
              <span className="text-muted-foreground">
                Gross
                {period.hourlyRateMinor !== undefined &&
                  ` · ${formatMinutes(period.projectedMinutes)} × ${money(period.hourlyRateMinor, period.currency)}`}
              </span>
              <span>{money(period.grossMinor, period.currency)}</span>
            </div>
            {period.lines.map((line) => (
              <div key={line.lineId} className="flex justify-between">
                <span className="text-muted-foreground">
                  {line.name}
                  <span className="ml-1 text-[10px]">
                    on {money(line.baseMinor, period.currency)}
                  </span>
                </span>
                <span>−{money(line.amountMinor, period.currency)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>
                Net{period.override?.netMinor !== undefined && " (set)"}
              </span>
              <span>{money(period.netMinor, period.currency)}</span>
            </div>
            {period.actual && (
              <div className="flex justify-between">
                <span className="truncate text-muted-foreground">
                  {shortDay(period.actual.effectiveDate)} ·{" "}
                  {period.actual.descriptor}
                </span>
                <span className="text-status-good">
                  {money(period.actual.amountMinor, period.actual.currency)}
                </span>
              </div>
            )}
            {period.actual && period.grossMinor > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Effective deduction</span>
                <span>
                  {Math.round(
                    (1 - period.actual.amountMinor / period.grossMinor) * 1000,
                  ) / 10}
                  %
                </span>
              </div>
            )}
          </div>

          <OverrideEditor ruleId={ruleId} period={period} onSaved={onSaved} />

          {period.projectedLedgerId && (
            <Button asChild size="xs" variant="ghost" className="-ml-2">
              <Link href={routes.finance.entry(period.projectedLedgerId)}>
                <Link2 className="size-3" />
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
      <div className="space-y-3 py-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  const periods = limit ? data.periods.slice(0, limit) : data.periods;
  if (periods.length === 0) return <Empty label="No payouts" compact />;

  return (
    <div className="divide-y">
      {periods.map((period) => (
        <PeriodRow
          key={period.payoutDate}
          ruleId={ruleId}
          period={period}
          onSaved={load}
        />
      ))}
    </div>
  );
}
