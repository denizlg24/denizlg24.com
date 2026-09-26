"use client";

import type {
  FinanceDashboardResponse,
  FinanceDeductionLine,
  FinanceDeductionProfile,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { Input } from "@repo/ui/input";
import { NumericField } from "@repo/ui/numeric-field";
import { ResponsiveDialog } from "@repo/ui/responsive-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import {
  computePayout,
  danishDeductionLines,
  describeRecurrence,
  majorToMinor,
  minorToMajor,
} from "@repo/utils";
import { ArrowDownLeft, Loader2, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  createFinanceDeductionProfile,
  deleteFinanceDeductionProfile,
  updateFinanceDeductionProfile,
} from "./finance-data";
import { Empty, FieldRow, Figure, SectionHead } from "./finance-primitives";
import { money, nextDueByRule, shortDay, todayKey } from "./finance-series";

interface LineDraft {
  id: string;
  name: string;
  kind: FinanceDeductionLine["kind"];
  /** Percent for `percent`, major units for `fixed`. */
  value: string;
  base: FinanceDeductionLine["base"];
  allowance: string;
  reducesTaxableBase: boolean;
}

function lineToDraft(line: FinanceDeductionLine, currency: string): LineDraft {
  return {
    id: line.id,
    name: line.name,
    kind: line.kind,
    value:
      line.kind === "percent"
        ? String(line.ratePercent ?? 0)
        : String(minorToMajor(line.amountMinor ?? 0, currency)),
    base: line.base,
    allowance: line.allowanceMinor
      ? String(minorToMajor(line.allowanceMinor, currency))
      : "",
    reducesTaxableBase: line.reducesTaxableBase,
  };
}

function draftToLine(draft: LineDraft, currency: string): FinanceDeductionLine {
  const value = Number(draft.value) || 0;
  const allowance = Number(draft.allowance) || 0;
  return {
    id: draft.id,
    name: draft.name.trim() || "Deduction",
    kind: draft.kind,
    ...(draft.kind === "percent"
      ? { ratePercent: Math.min(100, Math.max(0, value)) }
      : { amountMinor: Math.max(0, majorToMinor(value, currency)) }),
    base: draft.base,
    ...(allowance > 0
      ? { allowanceMinor: majorToMinor(allowance, currency) }
      : {}),
    reducesTaxableBase: draft.reducesTaxableBase,
  };
}

function newLineId() {
  return Math.random().toString(36).slice(2, 10);
}

function ProfileDialog({
  open,
  profile,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** Null creates. */
  profile: FinanceDeductionProfile | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [name, setName] = useState(profile?.name ?? "");
  const [currency, setCurrency] = useState(profile?.currency ?? "DKK");
  const [lines, setLines] = useState<LineDraft[]>(() =>
    (profile?.lines ?? []).map((line) =>
      lineToDraft(line, profile?.currency ?? "DKK"),
    ),
  );
  const [sample, setSample] = useState("20000");
  const [saving, setSaving] = useState(false);

  const parsed = useMemo(
    () => lines.map((line) => draftToLine(line, currency)),
    [lines, currency],
  );
  const preview = useMemo(
    () =>
      computePayout(
        Math.max(0, majorToMinor(Number(sample) || 0, currency)),
        parsed,
      ),
    [sample, currency, parsed],
  );

  function patchLine(id: string, next: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...next } : line)),
    );
  }

  function move(index: number, offset: number) {
    setLines((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(target, 0, row!);
      return next;
    });
  }

  async function save() {
    if (!name.trim()) return;
    setSaving(true);
    try {
      const input = { name: name.trim(), currency, lines: parsed };
      if (profile) {
        await updateFinanceDeductionProfile(client, profile.id, input);
      } else {
        await createFinanceDeductionProfile(client, input);
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? profile.name : "Deduction profile"}
      className="max-w-3xl"
    >
      <div className="space-y-5">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-3">
          <FieldRow label="Name" htmlFor="profile-name" className="min-w-0">
            <Input
              id="profile-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </FieldRow>
          <FieldRow label="Currency" className="min-w-0">
            <CurrencySelect value={currency} onValueChange={setCurrency} />
          </FieldRow>
        </div>

        <div className="space-y-2">
          <SectionHead label="Lines">
            {lines.length === 0 && (
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  setCurrency("DKK");
                  setLines(
                    danishDeductionLines().map((line) =>
                      lineToDraft(line, "DKK"),
                    ),
                  );
                  if (!name.trim()) setName("Denmark");
                }}
              >
                DK preset
              </Button>
            )}
            <Button
              size="xs"
              variant="ghost"
              onClick={() =>
                setLines((current) => [
                  ...current,
                  {
                    id: newLineId(),
                    name: "",
                    kind: "percent",
                    value: "",
                    base: "taxable",
                    allowance: "",
                    reducesTaxableBase: true,
                  },
                ])
              }
            >
              <Plus className="size-3" />
              Line
            </Button>
          </SectionHead>
          {lines.length === 0 ? (
            <Empty label="—" compact />
          ) : (
            <div className="divide-y">
              {lines.map((line, index) => (
                <div
                  key={line.id}
                  className="grid grid-cols-2 gap-2 py-3 sm:grid-cols-[minmax(0,1.4fr)_5.5rem_6rem_6.5rem_6.5rem_auto_auto] sm:items-end"
                >
                  <FieldRow label="Name" className="col-span-2 sm:col-span-1">
                    <Input
                      value={line.name}
                      onChange={(event) =>
                        patchLine(line.id, { name: event.target.value })
                      }
                      className="h-8 text-xs"
                    />
                  </FieldRow>
                  <FieldRow label="Kind">
                    <Select
                      value={line.kind}
                      onValueChange={(value) =>
                        patchLine(line.id, {
                          kind: value as LineDraft["kind"],
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="percent">%</SelectItem>
                        <SelectItem value="fixed">Fixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label={line.kind === "percent" ? "Rate" : "Amount"}>
                    <NumericField
                      value={line.value}
                      onValueChange={(value) => patchLine(line.id, { value })}
                      className="h-8 text-right text-xs tabular-nums"
                    />
                  </FieldRow>
                  <FieldRow label="On">
                    <Select
                      value={line.base}
                      onValueChange={(value) =>
                        patchLine(line.id, {
                          base: value as LineDraft["base"],
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-full text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="gross">Gross</SelectItem>
                        <SelectItem value="taxable">Taxable</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldRow>
                  <FieldRow label="Allowance">
                    <NumericField
                      value={line.allowance}
                      onValueChange={(value) =>
                        patchLine(line.id, { allowance: value })
                      }
                      placeholder="0"
                      className="h-8 text-right text-xs tabular-nums"
                    />
                  </FieldRow>
                  <FieldRow label="Pre-tax">
                    <div className="flex h-8 items-center">
                      <Switch
                        checked={line.reducesTaxableBase}
                        onCheckedChange={(checked) =>
                          patchLine(line.id, { reducesTaxableBase: checked })
                        }
                        aria-label={`${line.name || "Line"} reduces taxable base`}
                      />
                    </div>
                  </FieldRow>
                  <div className="flex h-8 items-center justify-end gap-0.5">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Move up"
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Move down"
                      disabled={index === lines.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Remove line"
                      onClick={() =>
                        setLines((current) =>
                          current.filter((row) => row.id !== line.id),
                        )
                      }
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-2 rounded-md bg-muted/40 p-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Gross
            </span>
            <NumericField
              value={sample}
              onValueChange={(value) => setSample(value)}
              className="h-7 w-32 text-right text-xs tabular-nums"
              aria-label="Sample gross"
            />
          </div>
          <div className="space-y-0.5 text-xs tabular-nums">
            {preview.lines.map((line) => (
              <div key={line.lineId} className="flex justify-between">
                <span className="text-muted-foreground">
                  {line.name}
                  <span className="ml-1 text-[10px]">
                    on {money(line.baseMinor, currency)}
                  </span>
                </span>
                <span>−{money(line.amountMinor, currency)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-medium">
              <span>Net</span>
              <span>{money(preview.netMinor, currency)}</span>
            </div>
          </div>
        </div>

        <Button
          className="w-full"
          disabled={saving || !name.trim()}
          onClick={() => void save()}
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          {profile ? "Save profile" : "Add profile"}
        </Button>
      </div>
    </ResponsiveDialog>
  );
}

export function FinancePayrollTab({
  data,
  onReload,
}: {
  data: FinanceDashboardResponse;
  onReload: () => Promise<void>;
}) {
  const { client, routes } = useAdmin();
  const [editing, setEditing] = useState<{
    profile: FinanceDeductionProfile | null;
  } | null>(null);
  const today = todayKey();
  const payouts = data.recurringRules.filter((rule) => rule.payout);
  const nextDue = useMemo(
    () => nextDueByRule(data.ledger, today),
    [data.ledger, today],
  );
  const profileName = new Map(
    data.deductionProfiles.map((profile) => [profile.id, profile.name]),
  );
  const next = payouts
    .filter((rule) => rule.status === "active")
    .map((rule) => ({ rule, due: nextDue.get(rule.id) }))
    .filter((row): row is { rule: typeof row.rule; due: string } =>
      Boolean(row.due),
    )
    .sort((a, b) => a.due.localeCompare(b.due))[0];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {next && (
          <div className="flex flex-wrap gap-x-12 gap-y-4">
            <Figure
              label="Next payout"
              value={money(next.rule.amountMinor, next.rule.currency)}
              meta={`${next.rule.name} · ${shortDay(next.due)}`}
            />
          </div>
        )}
        <SectionHead label="Payouts">
          <Button asChild size="xs" variant="ghost">
            <Link href={routes.finance.payoutNew}>
              <Plus className="size-3" />
              Payout
            </Link>
          </Button>
        </SectionHead>
        {payouts.length === 0 ? (
          <Empty label="No payouts" />
        ) : (
          <div className="divide-y">
            {payouts.map((rule) => {
              const due = nextDue.get(rule.id);
              const profile = rule.payout?.deductionProfileId
                ? profileName.get(rule.payout.deductionProfileId)
                : undefined;
              return (
                <Link
                  key={rule.id}
                  href={routes.finance.rule(rule.id)}
                  className="flex items-center gap-3 py-2.5 transition-opacity hover:opacity-70"
                >
                  <ArrowDownLeft className="size-3.5 shrink-0 text-status-good" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{rule.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {describeRecurrence(rule.recurrence)} · closes{" "}
                      {rule.payout?.cycleCloseDay}
                      {profile ? ` · ${profile}` : ""}
                      {due ? ` · due ${shortDay(due)}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-medium tabular-nums text-status-good">
                    {money(rule.amountMinor, rule.currency)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>

      <aside className="min-w-0 space-y-2">
        <SectionHead label="Deductions">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setEditing({ profile: null })}
          >
            <Plus className="size-3" />
            Profile
          </Button>
        </SectionHead>
        {data.deductionProfiles.length === 0 ? (
          <Empty label="—" compact />
        ) : (
          <div className="divide-y">
            {data.deductionProfiles.map((profile) => (
              <div
                key={profile.id}
                className="group flex items-center gap-2 py-2.5"
              >
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left transition-opacity hover:opacity-70"
                  onClick={() => setEditing({ profile })}
                >
                  <div className="truncate text-xs font-medium">
                    {profile.name}
                  </div>
                  <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {profile.lines
                      .map((line) =>
                        line.kind === "percent"
                          ? `${line.name} ${line.ratePercent ?? 0}%`
                          : `${line.name} ${money(line.amountMinor ?? 0, profile.currency)}`,
                      )
                      .join(" · ") || "—"}
                  </div>
                </button>
                <ConfirmButton
                  title={`Delete ${profile.name}?`}
                  actionLabel="Delete"
                  onConfirm={async () => {
                    try {
                      await deleteFinanceDeductionProfile(client, profile.id);
                      await onReload();
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Delete failed",
                      );
                    }
                  }}
                  trigger={
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Delete ${profile.name}`}
                      className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  }
                />
              </div>
            ))}
          </div>
        )}
      </aside>

      {editing && (
        <ProfileDialog
          key={editing.profile?.id ?? "new"}
          open
          profile={editing.profile}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          onSaved={onReload}
        />
      )}
    </div>
  );
}
