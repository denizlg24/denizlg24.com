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
import { EmptyState } from "@repo/ui/empty-state";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
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
    return <EmptyState compact label="No categories" className="py-2" />;
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
              "flex h-7 items-center rounded-md border px-2.5 text-xs transition-colors",
              isSelected
                ? "border-transparent bg-surface font-medium text-accent-strong dark:bg-muted"
                : "border-border text-muted-foreground hover:bg-surface/60 hover:text-accent-strong",
              blocked &&
                "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
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

/**
 * The envelope editor, without any chrome of its own.
 *
 * It was the body of a fixed-width sheet, which is why every choice in it is a
 * select: a page can put the form beside the spend it governs, so the caller
 * owns the layout and this owns only the fields.
 */
export function EnvelopeForm({
  envelope,
  seed,
  envelopes,
  accounts,
  categories,
  baseCurrency,
  onSaved,
  onDeleted,
  onCancel,
}: {
  /** Editing an existing envelope; absent means creating one. */
  envelope?: FinanceEnvelope | null;
  /** Pre-fill from a history-derived draft. */
  seed?: FinanceEnvelopeDraft | null;
  envelopes: FinanceEnvelope[];
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  baseCurrency: string;
  onSaved: (envelope: FinanceEnvelope) => void | Promise<void>;
  onDeleted?: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { client } = useAdmin();
  const [draft, setDraft] = useState<EnvelopeDraft>(() =>
    envelope
      ? fromEnvelope(envelope)
      : seed
        ? fromSuggestedDraft(seed, baseCurrency)
        : emptyDraft(baseCurrency),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (envelope) setDraft(fromEnvelope(envelope));
    else if (seed) setDraft(fromSuggestedDraft(seed, baseCurrency));
  }, [envelope, seed, baseCurrency]);

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
      const saved = envelope
        ? await updateFinanceEnvelope(client, envelope.id, payload)
        : await createFinanceEnvelope(client, payload);
      await onSaved(saved);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not save envelope",
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!envelope) return;
    setSaving(true);
    try {
      await deleteFinanceEnvelope(client, envelope.id);
      await onDeleted?.();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete envelope",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) void save();
      }}
    >
      <FormGrid>
        <FormField
          label="Name"
          htmlFor="envelope-name"
          className="sm:col-span-2"
        >
          <Input
            id="envelope-name"
            value={draft.name}
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
            placeholder="Groceries"
          />
        </FormField>

        <FormField label="Kind">
          <Select
            value={draft.kind}
            onValueChange={(value: FinanceEnvelopeKind) =>
              setDraft({ ...draft, kind: value })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="capped">Spending limit</SelectItem>
              <SelectItem value="sinking">Sinking fund</SelectItem>
            </SelectContent>
          </Select>
        </FormField>

        <FormField
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
            className="tabular-nums"
            placeholder="350"
          />
        </FormField>

        <FormField label={isSinking ? "Contribute" : "Period"}>
          <Select
            value={draft.period}
            onValueChange={(value: FinanceEnvelopePeriod) =>
              setDraft({ ...draft, period: value })
            }
          >
            <SelectTrigger className="w-full">
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
        </FormField>
        {draft.period !== "weekly" ? (
          <FormField label="Starts day" htmlFor="envelope-start-day">
            <Input
              id="envelope-start-day"
              inputMode="numeric"
              value={draft.periodStartDay}
              onChange={(event) =>
                setDraft({ ...draft, periodStartDay: event.target.value })
              }
              className="tabular-nums"
              placeholder="1"
            />
          </FormField>
        ) : (
          <div className="hidden sm:block" />
        )}

        {isSinking ? (
          <FormField label="Target date">
            <DatePicker
              value={draft.targetDate || undefined}
              onValueChange={(value) =>
                setDraft({ ...draft, targetDate: value ?? "" })
              }
              aria-label="Target date"
            />
          </FormField>
        ) : (
          <FormField label="Rollover">
            <Select
              value={draft.rollover}
              onValueChange={(value: FinanceEnvelopeRollover) =>
                setDraft({ ...draft, rollover: value })
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLLOVER_LABEL) as FinanceEnvelopeRollover[]).map(
                  (rollover) => (
                    <SelectItem key={rollover} value={rollover}>
                      {ROLLOVER_LABEL[rollover]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </FormField>
        )}
        <FormField label="Starts">
          <DatePicker
            value={draft.startDate}
            onValueChange={(value) =>
              setDraft({ ...draft, startDate: value ?? todayKey() })
            }
            aria-label="Start date"
          />
        </FormField>

        <FormField label="Account" className="sm:col-span-2">
          <Select
            value={draft.accountId || "all"}
            onValueChange={(value) =>
              setDraft({
                ...draft,
                accountId: value === "all" ? "" : value,
              })
            }
          >
            <SelectTrigger className="w-full">
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
        </FormField>
      </FormGrid>

      <FormField label="Categories">
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
      </FormField>

      <div className="flex items-center justify-between gap-3 text-sm">
        <label
          htmlFor="envelope-uncategorized"
          className={cn(
            uncategorizedOwner ? "text-muted-foreground" : "text-accent-strong",
          )}
        >
          Claim uncategorized spend
          {uncategorizedOwner && ` · taken by ${uncategorizedOwner.name}`}
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

      <FormField label="Notes" htmlFor="envelope-notes">
        <Textarea
          id="envelope-notes"
          rows={3}
          value={draft.notes}
          onChange={(event) =>
            setDraft({ ...draft, notes: event.target.value })
          }
        />
      </FormField>

      <div className="flex items-center gap-2 border-t pt-4">
        {envelope ? (
          <ConfirmButton
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
            title={`Delete ${envelope.name}?`}
            description="Its contribution history goes with it."
            actionLabel="Delete"
            destructive
            onConfirm={remove}
          />
        ) : null}
        <div className="flex-1" />
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={!canSave || saving}>
          {saving && <Loader2 className="animate-spin" />}
          {envelope ? "Save" : "Create"}
        </Button>
      </div>
    </form>
  );
}
