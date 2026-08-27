"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceEnvelope,
  FinanceEnvelopeDraft,
  FinanceEnvelopeKind,
  FinanceEnvelopePeriod,
  FinanceEnvelopeRollover,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { DatePicker } from "@repo/ui/date-picker";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@repo/ui/sheet";
import { SheetFormFooter } from "@repo/ui/sheet-form-footer";
import { Switch } from "@repo/ui/switch";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { majorToMinor, minorToMajor } from "@repo/utils";
import { Loader2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import {
  createFinanceEnvelope,
  deleteFinanceEnvelope,
  updateFinanceEnvelope,
} from "./finance-budget-data";
import { FieldRow } from "./finance-primitives";
import { todayKey } from "./finance-series";

const PERIOD_LABEL: Record<FinanceEnvelopePeriod, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
};

const ROLLOVER_LABEL: Record<FinanceEnvelopeRollover, string> = {
  none: "Reset each period",
  surplus: "Carry surplus",
  both: "Carry surplus and overspend",
};

interface EnvelopeDraft {
  name: string;
  kind: FinanceEnvelopeKind;
  categories: string[];
  includeUncategorized: boolean;
  accountId: string;
  currency: string;
  amount: string;
  period: FinanceEnvelopePeriod;
  periodStartDay: string;
  rollover: FinanceEnvelopeRollover;
  startDate: string;
  targetDate: string;
  notes: string;
}

function emptyDraft(currency: string): EnvelopeDraft {
  return {
    name: "",
    kind: "capped",
    categories: [],
    includeUncategorized: false,
    accountId: "",
    currency,
    amount: "",
    period: "monthly",
    periodStartDay: "1",
    rollover: "none",
    startDate: todayKey(),
    targetDate: "",
    notes: "",
  };
}

function fromEnvelope(envelope: FinanceEnvelope): EnvelopeDraft {
  return {
    name: envelope.name,
    kind: envelope.kind,
    categories: [...envelope.categories],
    includeUncategorized: envelope.includeUncategorized,
    accountId: envelope.accountId ?? "",
    currency: envelope.currency,
    amount: String(minorToMajor(envelope.limitMinor, envelope.currency)),
    period: envelope.period,
    periodStartDay: String(envelope.periodStartDay),
    rollover: envelope.rollover,
    startDate: envelope.startDate,
    targetDate: envelope.targetDate ?? "",
    notes: envelope.notes ?? "",
  };
}

function fromSuggestedDraft(
  draft: FinanceEnvelopeDraft,
  currency: string,
): EnvelopeDraft {
  return {
    ...emptyDraft(currency),
    name: draft.name,
    categories: [...draft.categories],
    currency: draft.currency,
    amount: String(minorToMajor(draft.suggestedLimitMinor, draft.currency)),
    period: draft.period,
  };
}

/**
 * Categories a given envelope may claim.
 *
 * A category already inside another active envelope is shown but disabled, not
 * hidden: the reason it cannot be picked is the useful information, and hiding
 * it just makes the list look wrong.
 */
function CategoryPicker({
  categories,
  selected,
  claimedBy,
  onToggle,
}: {
  categories: FinanceCategory[];
  selected: string[];
  claimedBy: Map<string, string>;
  onToggle: (name: string) => void;
}) {
  if (!categories.length) {
    return <p className="text-xs text-muted-foreground">No categories yet</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((category) => {
        const isSelected = selected.includes(category.name);
        const owner = claimedBy.get(category.name);
        const blocked = Boolean(owner) && !isSelected;
        return (
          <button
            key={category.id}
            type="button"
            disabled={blocked}
            title={blocked ? `Budgeted by ${owner}` : undefined}
            onClick={() => onToggle(category.name)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
              isSelected
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
              blocked && "cursor-not-allowed opacity-40 hover:border-border",
            )}
          >
            {category.color && (
              <span
                aria-hidden
                className="mr-1.5 inline-block size-1.5 rounded-full align-middle"
                style={{ backgroundColor: category.color }}
              />
            )}
            {category.name}
          </button>
        );
      })}
    </div>
  );
}

export function EnvelopeSheet({
  open,
  onOpenChange,
  envelope,
  seed,
  envelopes,
  accounts,
  categories,
  baseCurrency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Editing an existing envelope; absent means creating one. */
  envelope?: FinanceEnvelope | null;
  /** Pre-fill from a history-derived draft. */
  seed?: FinanceEnvelopeDraft | null;
  envelopes: FinanceEnvelope[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  baseCurrency: string;
  onSaved: () => void | Promise<void>;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<EnvelopeDraft>(() =>
    emptyDraft(baseCurrency),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (envelope) setDraft(fromEnvelope(envelope));
    else if (seed) setDraft(fromSuggestedDraft(seed, baseCurrency));
    else setDraft(emptyDraft(baseCurrency));
  }, [open, envelope, seed, baseCurrency]);

  const claimedBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const other of envelopes) {
      if (other.status !== "active") continue;
      if (envelope && other.id === envelope.id) continue;
      for (const category of other.categories) map.set(category, other.name);
    }
    return map;
  }, [envelopes, envelope]);

  const uncategorizedOwner = useMemo(
    () =>
      envelopes.find(
        (other) =>
          other.status === "active" &&
          other.includeUncategorized &&
          other.id !== envelope?.id,
      ),
    [envelopes, envelope],
  );

  const isSinking = draft.kind === "sinking";
  const amountValid =
    Number.isFinite(Number(draft.amount)) && draft.amount !== "";
  const canSave =
    draft.name.trim().length > 0 &&
    amountValid &&
    Number(draft.amount) >= 0 &&
    (!isSinking || draft.targetDate !== "");

  async function save() {
    if (!canSave) return;
    setSaving(true);
    try {
      const payload = {
        name: draft.name.trim(),
        kind: draft.kind,
        categories: draft.categories,
        includeUncategorized: draft.includeUncategorized,
        accountId: draft.accountId || undefined,
        limitMinor: majorToMinor(Number(draft.amount), draft.currency),
        period: draft.period,
        periodStartDay: Number(draft.periodStartDay) || 1,
        rollover: draft.rollover,
        startDate: draft.startDate,
        targetDate: isSinking ? draft.targetDate : undefined,
        notes: draft.notes.trim() || undefined,
      };
      if (envelope) {
        await updateFinanceEnvelope(client, envelope.id, payload);
      } else {
        await createFinanceEnvelope(client, payload);
      }
      onOpenChange(false);
      await onSaved();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save envelope",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-sm">
            {envelope ? envelope.name : "New envelope"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Configure a budget envelope
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          <FieldRow label="Name" htmlFor="envelope-name">
            <Input
              id="envelope-name"
              value={draft.name}
              onChange={(event) =>
                setDraft({ ...draft, name: event.target.value })
              }
              placeholder="Groceries"
            />
          </FieldRow>

          <FieldRow label="Kind">
            <Select
              value={draft.kind}
              onValueChange={(value: FinanceEnvelopeKind) =>
                setDraft({ ...draft, kind: value })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="capped">Spending limit</SelectItem>
                <SelectItem value="sinking">Sinking fund</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>

          <FieldRow
            label={`${isSinking ? "Target" : "Limit"} (${draft.currency})`}
            htmlFor="envelope-amount"
          >
            <Input
              id="envelope-amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(event) =>
                setDraft({ ...draft, amount: event.target.value })
              }
              placeholder="350"
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label={isSinking ? "Contribute" : "Period"}>
              <Select
                value={draft.period}
                onValueChange={(value: FinanceEnvelopePeriod) =>
                  setDraft({ ...draft, period: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABEL) as FinanceEnvelopePeriod[]).map(
                    (period) => (
                      <SelectItem key={period} value={period}>
                        {PERIOD_LABEL[period]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </FieldRow>
            {draft.period !== "weekly" && (
              <FieldRow label="Starts day" htmlFor="envelope-start-day">
                <Input
                  id="envelope-start-day"
                  inputMode="numeric"
                  value={draft.periodStartDay}
                  onChange={(event) =>
                    setDraft({ ...draft, periodStartDay: event.target.value })
                  }
                  placeholder="1"
                />
              </FieldRow>
            )}
          </div>

          {isSinking ? (
            <FieldRow label="Target date">
              <DatePicker
                value={draft.targetDate || undefined}
                onValueChange={(value) =>
                  setDraft({ ...draft, targetDate: value ?? "" })
                }
              />
            </FieldRow>
          ) : (
            <FieldRow label="Rollover">
              <Select
                value={draft.rollover}
                onValueChange={(value: FinanceEnvelopeRollover) =>
                  setDraft({ ...draft, rollover: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(ROLLOVER_LABEL) as FinanceEnvelopeRollover[]
                  ).map((rollover) => (
                    <SelectItem key={rollover} value={rollover}>
                      {ROLLOVER_LABEL[rollover]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
          )}

          <FieldRow label="Categories">
            <CategoryPicker
              categories={categories}
              selected={draft.categories}
              claimedBy={claimedBy}
              onToggle={(name) =>
                setDraft({
                  ...draft,
                  categories: draft.categories.includes(name)
                    ? draft.categories.filter((value) => value !== name)
                    : [...draft.categories, name],
                })
              }
            />
          </FieldRow>

          <div className="flex items-center justify-between gap-3 text-xs">
            <label
              htmlFor="envelope-uncategorized"
              className={cn(uncategorizedOwner && "text-muted-foreground")}
            >
              Claim uncategorized spend
              {uncategorizedOwner && ` — taken by ${uncategorizedOwner.name}`}
            </label>
            <Switch
              id="envelope-uncategorized"
              checked={draft.includeUncategorized}
              disabled={Boolean(uncategorizedOwner)}
              onCheckedChange={(checked) =>
                setDraft({ ...draft, includeUncategorized: checked })
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Account">
              <Select
                value={draft.accountId || "all"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    accountId: value === "all" ? "" : value,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FieldRow>
            <FieldRow label="Starts">
              <DatePicker
                value={draft.startDate}
                onValueChange={(value) =>
                  setDraft({ ...draft, startDate: value ?? todayKey() })
                }
              />
            </FieldRow>
          </div>

          <FieldRow label="Notes" htmlFor="envelope-notes">
            <Textarea
              id="envelope-notes"
              rows={2}
              value={draft.notes}
              onChange={(event) =>
                setDraft({ ...draft, notes: event.target.value })
              }
            />
          </FieldRow>
        </div>

        <SheetFormFooter>
          {envelope ? (
            <ConfirmButton
              trigger={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label="Delete envelope"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              }
              title={`Delete ${envelope.name}?`}
              description="Its contribution history goes with it. Archiving keeps the record."
              actionLabel="Delete"
              onConfirm={async () => {
                setSaving(true);
                try {
                  await deleteFinanceEnvelope(client, envelope.id);
                  onOpenChange(false);
                  await onSaved();
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? error.message
                      : "Could not delete envelope",
                  );
                } finally {
                  setSaving(false);
                }
              }}
            />
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={!canSave || saving}
            onClick={() => void save()}
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {envelope ? "Save" : "Create"}
          </Button>
        </SheetFormFooter>
      </SheetContent>
    </Sheet>
  );
}
