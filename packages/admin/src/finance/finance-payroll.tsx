"use client";

import type {
  FinanceDashboardResponse,
  FinanceDeductionLine,
  FinanceDeductionProfile,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { NumericField } from "@repo/ui/numeric-field";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Stat, StatGroup } from "@repo/ui/stat";
import { Switch } from "@repo/ui/switch";
import {
  computePayout,
  danishDeductionLines,
  describeRecurrence,
  majorToMinor,
  minorToMajor,
} from "@repo/utils";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  createFinanceDeductionProfile,
  deleteFinanceDeductionProfile,
  updateFinanceDeductionProfile,
} from "./finance-data";
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
      if (!row) return current;
      next.splice(target, 0, row);
      return next;
    });
  }

  async function save() {
    if (!name.trim() || saving) return;
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

  async function remove() {
    if (!profile) return;
    try {
      await deleteFinanceDeductionProfile(client, profile.id);
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={profile ? profile.name : "Deduction profile"}
      size="lg"
      onSubmit={save}
      submitLabel={profile ? "Save profile" : "Add profile"}
      submitDisabled={!name.trim()}
      pending={saving}
      footerStart={
        profile ? (
          <ConfirmButton
            title={`Delete ${profile.name}?`}
            actionLabel="Delete"
            destructive
            onConfirm={remove}
            trigger={
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 />
                Delete
              </Button>
            }
          />
        ) : undefined
      }
    >
      <FormGrid>
        <FormField label="Name" htmlFor="profile-name">
          <Input
            id="profile-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </FormField>
        <FormField label="Currency">
          <CurrencySelect value={currency} onValueChange={setCurrency} />
        </FormField>
      </FormGrid>

      <Section
        title="Lines"
        count={lines.length}
        actions={
          <>
            {lines.length === 0 && (
              <Button
                type="button"
                size="sm"
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
              type="button"
              size="sm"
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
              <Plus />
              Line
            </Button>
          </>
        }
      >
        {lines.length === 0 ? (
          <EmptyState compact label="No lines" />
        ) : (
          <div className="flex flex-col divide-y divide-border/70">
            {lines.map((line, index) => (
              <div
                key={line.id}
                className="grid grid-cols-2 gap-3 py-3 first:pt-0 sm:grid-cols-[minmax(0,1.4fr)_6rem_7rem_7rem_7rem_auto_auto] sm:items-end"
              >
                <FormField label="Name" className="col-span-2 sm:col-span-1">
                  <Input
                    aria-label="Line name"
                    value={line.name}
                    onChange={(event) =>
                      patchLine(line.id, { name: event.target.value })
                    }
                  />
                </FormField>
                <FormField label="Kind">
                  <Select
                    value={line.kind}
                    onValueChange={(value) =>
                      patchLine(line.id, {
                        kind: value === "fixed" ? "fixed" : "percent",
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="percent">%</SelectItem>
                      <SelectItem value="fixed">Fixed</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={line.kind === "percent" ? "Rate" : "Amount"}>
                  <NumericField
                    value={line.value}
                    onValueChange={(value) => patchLine(line.id, { value })}
                    className="text-right tabular-nums"
                  />
                </FormField>
                <FormField label="On">
                  <Select
                    value={line.base}
                    onValueChange={(value) =>
                      patchLine(line.id, {
                        base: value === "gross" ? "gross" : "taxable",
                      })
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gross">Gross</SelectItem>
                      <SelectItem value="taxable">Taxable</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Allowance">
                  <NumericField
                    value={line.allowance}
                    onValueChange={(value) =>
                      patchLine(line.id, { allowance: value })
                    }
                    placeholder="0"
                    className="text-right tabular-nums"
                  />
                </FormField>
                <FormField label="Pre-tax">
                  <div className="flex h-8 items-center">
                    <Switch
                      checked={line.reducesTaxableBase}
                      onCheckedChange={(checked) =>
                        patchLine(line.id, { reducesTaxableBase: checked })
                      }
                      aria-label={`${line.name || "Line"} reduces taxable base`}
                    />
                  </div>
                </FormField>
                <div className="flex h-8 items-center justify-end gap-0.5">
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move up"
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Move down"
                    disabled={index === lines.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Remove line"
                    onClick={() =>
                      setLines((current) =>
                        current.filter((row) => row.id !== line.id),
                      )
                    }
                  >
                    <X />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Preview"
        actions={
          <NumericField
            value={sample}
            onValueChange={(value) => setSample(value)}
            className="h-7 w-32 text-right text-xs tabular-nums"
            aria-label="Sample gross"
          />
        }
      >
        <div className="flex flex-col gap-0.5 text-xs tabular-nums">
          {preview.lines.map((line) => (
            <div key={line.lineId} className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {line.name} on {money(line.baseMinor, currency)}
              </span>
              <span className="text-accent-strong">
                −{money(line.amountMinor, currency)}
              </span>
            </div>
          ))}
          <div className="flex justify-between border-t pt-1 font-medium text-accent-strong">
            <span>Net</span>
            <span>{money(preview.netMinor, currency)}</span>
          </div>
        </div>
      </Section>
    </FormDialog>
  );
}

export function FinancePayrollTab({
  data,
  onReload,
}: {
  data: FinanceDashboardResponse;
  onReload: () => Promise<void>;
}) {
  const { routes } = useAdmin();
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
      <div className="flex min-w-0 flex-col gap-6">
        {next && (
          <StatGroup>
            <Stat
              label="Next payout"
              value={money(next.rule.amountMinor, next.rule.currency)}
              hint={`${next.rule.name} · ${shortDay(next.due)}`}
            />
          </StatGroup>
        )}
        <Section
          title="Payouts"
          count={payouts.length}
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link href={routes.finance.payoutNew}>
                <Plus />
                Payout
              </Link>
            </Button>
          }
        >
          {payouts.length === 0 ? (
            <EmptyState compact icon={<ArrowDownLeft />} label="No payouts" />
          ) : (
            <List divided>
              {payouts.map((rule) => {
                const due = nextDue.get(rule.id);
                const profile = rule.payout?.deductionProfileId
                  ? profileName.get(rule.payout.deductionProfileId)
                  : undefined;
                return (
                  <Link key={rule.id} href={routes.finance.rule(rule.id)}>
                    <ListRow
                      leading={<ArrowDownLeft className="text-status-good" />}
                      title={rule.name}
                      description={`${describeRecurrence(rule.recurrence)} · closes ${rule.payout?.cycleCloseDay}${profile ? ` · ${profile}` : ""}${due ? ` · due ${shortDay(due)}` : ""}`}
                      meta={
                        <span className="text-sm font-medium text-status-good">
                          {money(rule.amountMinor, rule.currency)}
                        </span>
                      }
                    />
                  </Link>
                );
              })}
            </List>
          )}
        </Section>
      </div>

      <aside className="min-w-0">
        <Section
          title="Deductions"
          count={data.deductionProfiles.length}
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditing({ profile: null })}
            >
              <Plus />
              Profile
            </Button>
          }
        >
          {data.deductionProfiles.length === 0 ? (
            <EmptyState compact label="No profiles" />
          ) : (
            <List divided>
              {data.deductionProfiles.map((profile) => (
                <ListRow
                  key={profile.id}
                  onClick={() => setEditing({ profile })}
                  title={profile.name}
                  description={
                    profile.lines
                      .map((line) =>
                        line.kind === "percent"
                          ? `${line.name} ${line.ratePercent ?? 0}%`
                          : `${line.name} ${money(line.amountMinor ?? 0, profile.currency)}`,
                      )
                      .join(" · ") || "—"
                  }
                />
              ))}
            </List>
          )}
        </Section>
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
