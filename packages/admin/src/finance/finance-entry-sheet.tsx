"use client";

import type {
  FinanceAccount,
  FinanceCategory,
  FinanceLedgerEntry,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { DatePicker } from "@repo/ui/date-picker";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { SearchSelect } from "@repo/ui/search-select";
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
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { Toggle } from "@repo/ui/toggle";
import { majorToMinor, minorToMajor } from "@repo/utils";
import {
  CalendarClock,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { CategoryField } from "./finance-category-field";
import {
  createExpectedFinanceEntry,
  createFinanceEntry,
  createNaturalFinanceEntry,
  deleteFinanceEntry,
  linkFinanceEntry,
  unlinkFinanceEntry,
  updateFinanceEntry,
} from "./finance-data";
import { FieldRow } from "./finance-primitives";
import { money, shortDay, todayKey } from "./finance-series";

function DirectionToggle({
  value,
  onChange,
}: {
  value: "expense" | "income";
  onChange: (next: "expense" | "income") => void;
}) {
  return (
    <div className="flex gap-1">
      {(["expense", "income"] as const).map((option) => (
        <Toggle
          key={option}
          size="sm"
          variant="outline"
          pressed={value === option}
          onPressedChange={() => onChange(option)}
          className="flex-1 capitalize"
        >
          {option}
        </Toggle>
      ))}
    </div>
  );
}

function AmountField({
  id,
  currency,
  value,
  onChange,
  onCurrencyChange,
  inputRef,
}: {
  id: string;
  currency: string;
  value: string;
  onChange: (next: string) => void;
  onCurrencyChange: (next: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
      <FieldRow label="Amount" htmlFor={id} className="min-w-0">
        <Input
          id={id}
          ref={inputRef}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="text-right text-lg font-medium tabular-nums"
          placeholder="0.00"
        />
      </FieldRow>
      <FieldRow label="Currency" className="min-w-0">
        <CurrencySelect value={currency} onValueChange={onCurrencyChange} />
      </FieldRow>
    </div>
  );
}

export function EntrySheet({
  open,
  onOpenChange,
  accounts,
  categories,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onCreated: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? "EUR");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [date, setDate] = useState(todayKey);
  const [descriptor, setDescriptor] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [phrase, setPhrase] = useState("");
  const [windowDays, setWindowDays] = useState("5");
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];

  useEffect(() => {
    if (!open) return;
    setAccountId((current) => {
      const next = accounts.some((item) => item.id === current)
        ? current
        : (accounts[0]?.id ?? "");
      const resolved = accounts.find((item) => item.id === next);
      if (resolved) setCurrency(resolved.currency);
      return next;
    });
    const timer = window.setTimeout(() => amountRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, [open, accounts]);

  function reset() {
    setAmount("");
    setDescriptor("");
    setNote("");
    setPhrase("");
    setCategory(undefined);
  }

  const ready = Boolean(account && amount && descriptor.trim());

  async function saveManual(keepOpen: boolean) {
    if (!account || !ready) return;
    setSaving(true);
    try {
      await createFinanceEntry(client, {
        accountId: account.id,
        amountMinor: Math.abs(majorToMinor(Number(amount), currency)),
        currency,
        direction,
        effectiveDate: date,
        descriptor,
        note: note || undefined,
      });
      toast.success("Entry added");
      reset();
      if (!keepOpen) onOpenChange(false);
      else amountRef.current?.focus();
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entry failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveExpected() {
    if (!account || !ready) return;
    setSaving(true);
    try {
      await createExpectedFinanceEntry(client, {
        accountId: account.id,
        amountMinor: Math.abs(majorToMinor(Number(amount), currency)),
        currency,
        direction,
        effectiveDate: date,
        descriptor,
        category,
        matchWindowDays: Math.max(0, Number(windowDays) || 0),
      });
      toast.success("Expected entry added");
      reset();
      onOpenChange(false);
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entry failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveNatural() {
    if (!account || !phrase.trim()) return;
    setSaving(true);
    try {
      const entry = await createNaturalFinanceEntry(client, {
        accountId: account.id,
        text: phrase,
      });
      toast.success(
        `${entry.descriptor} · ${money(entry.amountMinor, entry.currency)}`,
      );
      setPhrase("");
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Parse failed");
    } finally {
      setSaving(false);
    }
  }

  const accountSelect = (
    <FieldRow label="Account">
      <Select
        value={account?.id ?? ""}
        onValueChange={(value) => {
          setAccountId(value);
          const next = accounts.find((item) => item.id === value);
          if (next) setCurrency(next.currency);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((item) => (
            <SelectItem key={item.id} value={item.id}>
              {item.displayName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldRow>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New entry</SheetTitle>
          <SheetDescription className="sr-only">
            Add a ledger entry
          </SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="manual" className="gap-5 px-4 pb-6">
          <TabsList variant="line">
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="expected">
              <CalendarClock className="size-3" />
              Expected
            </TabsTrigger>
            <TabsTrigger value="quick">
              <Sparkles className="size-3" />
              Quick
            </TabsTrigger>
          </TabsList>

          <TabsContent
            value="manual"
            className="space-y-5"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void saveManual(false);
              }
            }}
          >
            <DirectionToggle value={direction} onChange={setDirection} />
            <AmountField
              id="finance-amount"
              inputRef={amountRef}
              currency={currency}
              value={amount}
              onChange={setAmount}
              onCurrencyChange={setCurrency}
            />
            {accountSelect}
            <FieldRow label="Date">
              <div className="flex gap-2">
                <DatePicker
                  value={date}
                  onValueChange={(value) => setDate(value ?? todayKey())}
                  aria-label="Entry date"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDate(todayKey())}
                >
                  Today
                </Button>
              </div>
            </FieldRow>
            <FieldRow label="Description" htmlFor="finance-descriptor">
              <Input
                id="finance-descriptor"
                value={descriptor}
                onChange={(event) => setDescriptor(event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Note" htmlFor="finance-note">
              <Textarea
                id="finance-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
              />
            </FieldRow>
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => void saveManual(false)}
                disabled={saving || !ready}
              >
                {saving && <Loader2 className="size-4 animate-spin" />}
                Add
              </Button>
              <Button
                variant="outline"
                onClick={() => void saveManual(true)}
                disabled={saving || !ready}
              >
                Add & next
              </Button>
            </div>
          </TabsContent>

          <TabsContent
            value="expected"
            className="space-y-5"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void saveExpected();
              }
            }}
          >
            <DirectionToggle value={direction} onChange={setDirection} />
            <AmountField
              id="expected-amount"
              currency={currency}
              value={amount}
              onChange={setAmount}
              onCurrencyChange={setCurrency}
            />
            {accountSelect}
            <FieldRow label="Expected on">
              <DatePicker
                value={date}
                onValueChange={(value) => setDate(value ?? todayKey())}
                aria-label="Expected date"
              />
            </FieldRow>
            <FieldRow label="Description" htmlFor="expected-descriptor">
              <Input
                id="expected-descriptor"
                value={descriptor}
                onChange={(event) => setDescriptor(event.target.value)}
              />
            </FieldRow>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
              <FieldRow label="Category" className="min-w-0">
                <CategoryField
                  value={category}
                  onValueChange={setCategory}
                  categories={categories}
                />
              </FieldRow>
              <FieldRow label="Window (d)" htmlFor="expected-window">
                <Input
                  id="expected-window"
                  type="number"
                  min={0}
                  max={60}
                  value={windowDays}
                  onChange={(event) => setWindowDays(event.target.value)}
                  className="w-20 tabular-nums"
                />
              </FieldRow>
            </div>
            <Button
              className="w-full"
              onClick={() => void saveExpected()}
              disabled={saving || !ready}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Add expected
            </Button>
          </TabsContent>

          <TabsContent
            value="quick"
            className="space-y-5"
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void saveNatural();
              }
            }}
          >
            <Textarea
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              rows={3}
              placeholder="lunch 12.40 yesterday"
            />
            {accountSelect}
            <Button
              className="w-full"
              onClick={() => void saveNatural()}
              disabled={saving || !phrase.trim() || !account}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              Parse
            </Button>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Editing an existing entry. Bank rows expose only the category — their amount,
 * date and descriptor are the provider's record and the next sync would
 * overwrite any local edit, so the server rejects those fields outright.
 */
/**
 * Attaching an expected or manual entry to the bank row it turned out to be.
 *
 * Automatic reconciliation misses cases it cannot see past — an unusual FX
 * spread, a merchant billing under another name, two identical charges in one
 * window — and this is how those get resolved.
 */
function MatchSection({
  entry,
  ledger,
  onSaved,
}: {
  entry: FinanceLedgerEntry;
  ledger: FinanceLedgerEntry[];
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  const linked = useMemo(
    () =>
      entry.linkedLedgerId
        ? ledger.find((row) => row.id === entry.linkedLedgerId)
        : undefined,
    [entry.linkedLedgerId, ledger],
  );

  // Nearest first: the right row is nearly always within days of the expected
  // date, and an account can hold hundreds of transactions.
  const candidates = useMemo(() => {
    if (entry.linkedLedgerId) return [];
    return ledger
      .filter(
        (row) =>
          row.origin === "bank" &&
          row.state === "booked" &&
          !row.linkedLedgerId &&
          row.accountId === entry.accountId,
      )
      .map((row) => ({
        row,
        distance: Math.abs(
          Date.parse(`${row.effectiveDate}T00:00:00Z`) -
            Date.parse(`${entry.effectiveDate}T00:00:00Z`),
        ),
      }))
      .sort((left, right) => left.distance - right.distance)
      .slice(0, 60)
      .map(({ row }) => ({
        value: row.id,
        label: `${shortDay(row.effectiveDate)} · ${row.descriptor}`,
        keywords: `${row.descriptor} ${money(row.amountMinor, row.currency)}`,
        meta: money(row.amountMinor, row.currency),
      }));
  }, [entry, ledger]);

  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await action();
      toast.success(message);
      setChoice("");
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Match failed");
    } finally {
      setBusy(false);
    }
  }

  if (entry.linkedLedgerId) {
    return (
      <div className="space-y-2 border-t pt-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Matched
          </span>
          <span className="text-[11px] text-muted-foreground">
            {entry.matchMethod ?? "—"}
          </span>
        </div>
        <div className="flex min-w-0 items-baseline gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            {linked ? linked.descriptor : "linked entry"}
          </span>
          {linked && (
            <span className="shrink-0 tabular-nums">
              {money(linked.amountMinor, linked.currency)}
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={busy}
          onClick={() =>
            void run(() => unlinkFinanceEntry(client, entry.id), "Unlinked")
          }
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Unlink className="size-3.5" />
          )}
          Unlink
        </Button>
      </div>
    );
  }

  if (entry.origin === "bank") return null;

  return (
    <div className="space-y-2 border-t pt-4">
      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        Match to transaction
      </span>
      <SearchSelect
        value={choice}
        onValueChange={setChoice}
        options={candidates}
        placeholder="Pick a transaction"
        searchPlaceholder="Search transactions"
        emptyLabel="Nothing unmatched"
        aria-label="Bank transaction to match"
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={busy || !choice}
        onClick={() =>
          void run(
            () => linkFinanceEntry(client, entry.id, choice),
            "Entries matched",
          )
        }
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Link2 className="size-3.5" />
        )}
        Match
      </Button>
    </div>
  );
}

export function EntryDetailSheet({
  entry,
  accounts,
  categories,
  ledger,
  onClose,
  onSaved,
}: {
  entry: FinanceLedgerEntry | null;
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  ledger: FinanceLedgerEntry[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [category, setCategory] = useState<string | undefined>();
  const [descriptor, setDescriptor] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [date, setDate] = useState(todayKey);
  const [applyToMerchant, setApplyToMerchant] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry) return;
    setCategory(entry.category);
    setDescriptor(entry.descriptor);
    setNote(entry.origin === "manual" ? (entry.note ?? "") : "");
    setAmount(
      String(Math.abs(minorToMajor(entry.amountMinor, entry.currency))),
    );
    setDirection(entry.amountMinor < 0 ? "expense" : "income");
    setDate(entry.effectiveDate);
    setApplyToMerchant(false);
  }, [entry]);

  const readOnly = entry?.origin === "bank";
  const deletable =
    entry !== null &&
    entry.origin !== "bank" &&
    !(entry.origin === "projected" && entry.recurringRuleId);
  const accountName = entry
    ? (accounts.find((item) => item.id === entry.accountId)?.displayName ?? "—")
    : "";

  async function save() {
    if (!entry) return;
    setSaving(true);
    try {
      await updateFinanceEntry(client, entry.id, {
        category: category ?? null,
        applyToMerchant,
        ...(readOnly
          ? {}
          : {
              descriptor,
              note: note ? note : null,
              amountMinor: Math.abs(
                majorToMinor(Number(amount), entry.currency),
              ),
              direction,
              effectiveDate: date,
            }),
      });
      toast.success("Entry updated");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="truncate">{entry?.descriptor}</SheetTitle>
          <SheetDescription>
            {entry
              ? `${accountName} · ${entry.origin}${
                  entry.origin === "projected" && !entry.recurringRuleId
                    ? " (one-off)"
                    : ""
                }`
              : ""}
          </SheetDescription>
        </SheetHeader>
        {entry && (
          <div className="space-y-5 px-4 pb-6">
            <div className="flex items-baseline justify-between">
              <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Amount
              </span>
              <span
                className={
                  entry.amountMinor > 0
                    ? "text-lg font-semibold tabular-nums text-status-good"
                    : "text-lg font-semibold tabular-nums"
                }
              >
                {money(entry.amountMinor, entry.currency)}
              </span>
            </div>

            <FieldRow label="Category">
              <CategoryField
                value={category}
                onValueChange={setCategory}
                categories={categories}
                extra={entry.category}
              />
            </FieldRow>

            <div className="flex items-center justify-between">
              <Label
                htmlFor="entry-apply-merchant"
                className="text-xs font-normal"
              >
                Apply to this merchant
              </Label>
              <Switch
                id="entry-apply-merchant"
                checked={applyToMerchant}
                onCheckedChange={setApplyToMerchant}
              />
            </div>

            {!readOnly && (
              <>
                <DirectionToggle value={direction} onChange={setDirection} />
                <FieldRow label="Amount" htmlFor="entry-amount">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      {entry.currency}
                    </span>
                    <Input
                      id="entry-amount"
                      type="number"
                      inputMode="decimal"
                      min="0"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      className="pl-12 text-right font-medium tabular-nums"
                    />
                  </div>
                </FieldRow>
                <FieldRow label="Description" htmlFor="entry-descriptor">
                  <Input
                    id="entry-descriptor"
                    value={descriptor}
                    onChange={(event) => setDescriptor(event.target.value)}
                  />
                </FieldRow>
                <FieldRow label="Date">
                  <DatePicker
                    value={date}
                    onValueChange={(value) => setDate(value ?? todayKey())}
                    aria-label="Entry date"
                  />
                </FieldRow>
                {entry.origin === "manual" && (
                  <FieldRow label="Note" htmlFor="entry-note">
                    <Textarea
                      id="entry-note"
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                    />
                  </FieldRow>
                )}
              </>
            )}

            <Button
              className="w-full"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save
            </Button>

            <MatchSection entry={entry} ledger={ledger} onSaved={onSaved} />

            {deletable && (
              <ConfirmButton
                title={`Delete ${entry.descriptor}?`}
                actionLabel="Delete"
                onConfirm={async () => {
                  try {
                    await deleteFinanceEntry(client, entry.id);
                    toast.success("Entry deleted");
                    onClose();
                    await onSaved();
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Delete failed",
                    );
                  }
                }}
                trigger={
                  <Button variant="ghost" className="w-full text-destructive">
                    <Trash2 className="size-4" />
                    Delete
                  </Button>
                }
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
