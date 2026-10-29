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
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { SearchSelect } from "@repo/ui/search-select";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Switch } from "@repo/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { majorToMinor, minorToMajor } from "@repo/utils";
import {
  CalendarClock,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { money, shortDay, todayKey } from "./finance-series";

type Direction = "expense" | "income";

const DIRECTION_OPTIONS: { value: Direction; label: string }[] = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
];

function DirectionToggle({
  value,
  onChange,
}: {
  value: Direction;
  onChange: (next: Direction) => void;
}) {
  return (
    <FilterTabs value={value} onChange={onChange} options={DIRECTION_OPTIONS} />
  );
}

/** A form that submits on Enter (and on ⌘/Ctrl+Enter from a textarea). */
function EntryFormBody({
  onSubmit,
  actions,
  children,
}: {
  onSubmit: () => void;
  actions: ReactNode;
  children: ReactNode;
}) {
  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSubmit();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          onSubmit();
        }
      }}
    >
      {children}
      <div className="flex items-center justify-end gap-2 border-t pt-4">
        {actions}
      </div>
    </form>
  );
}

function positiveAmount(amount: string) {
  const value = Number(amount);
  return Number.isFinite(value) && value > 0;
}

export function EntryForm({
  accounts,
  categories,
  onCreated,
  onDone,
}: {
  accounts: FinanceAccount[];
  categories: FinanceCategory[];
  onCreated: () => Promise<void>;
  /** Leaves the form — a page navigates away where a sheet just closed. */
  onDone: () => void;
}) {
  const { client } = useAdmin();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [currency, setCurrency] = useState(accounts[0]?.currency ?? "EUR");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
  const [date, setDate] = useState(todayKey);
  const [descriptor, setDescriptor] = useState("");
  const [category, setCategory] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [phrase, setPhrase] = useState("");
  const [windowDays, setWindowDays] = useState("5");
  const [saving, setSaving] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);

  const account = accounts.find((item) => item.id === accountId) ?? accounts[0];

  // Keyed on the account identities rather than the array: `onCreated()` hands
  // back a fresh array on every reload, and on the "Add & next" path that would
  // re-run mid-session, resetting a deliberately chosen currency and stealing
  // focus back to the amount field.
  const accountKey = accounts
    .map((item) => `${item.id}:${item.currency}`)
    .join();

  useEffect(() => {
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
  }, [accountKey]);

  function reset() {
    setAmount("");
    setDescriptor("");
    setNote("");
    setPhrase("");
    setCategory(undefined);
  }

  const ready = Boolean(account && positiveAmount(amount) && descriptor.trim());

  async function saveManual(keepOpen: boolean) {
    if (!account || !ready || saving) return;
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
      if (!keepOpen) onDone();
      else amountRef.current?.focus();
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entry failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveExpected() {
    if (!account || !ready || saving) return;
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
      onDone();
      await onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Entry failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveNatural() {
    if (!account || !phrase.trim() || saving) return;
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
    <FormField label="Account">
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
    </FormField>
  );

  const amountFields = (id: string, withRef: boolean) => (
    <>
      <FormField label="Amount" htmlFor={id}>
        <Input
          id={id}
          ref={withRef ? amountRef : undefined}
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="text-right font-medium tabular-nums"
          placeholder="0.00"
        />
      </FormField>
      <FormField label="Currency">
        <CurrencySelect value={currency} onValueChange={setCurrency} />
      </FormField>
    </>
  );

  const spinner = saving ? <Loader2 className="animate-spin" /> : null;

  return (
    <Tabs defaultValue="manual" className="gap-5">
      <TabsList variant="line">
        <TabsTrigger value="manual" className="flex-none">
          Manual
        </TabsTrigger>
        <TabsTrigger value="expected" className="flex-none">
          <CalendarClock />
          Expected
        </TabsTrigger>
        <TabsTrigger value="quick" className="flex-none">
          <Sparkles />
          Quick
        </TabsTrigger>
      </TabsList>

      <TabsContent value="manual">
        <EntryFormBody
          onSubmit={() => void saveManual(false)}
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => void saveManual(true)}
                disabled={saving || !ready}
              >
                Add & next
              </Button>
              <Button type="submit" disabled={saving || !ready}>
                {spinner}
                Add
              </Button>
            </>
          }
        >
          <DirectionToggle value={direction} onChange={setDirection} />
          <FormGrid>
            {amountFields("finance-amount", true)}
            {accountSelect}
            <FormField label="Date">
              <div className="flex gap-2">
                <DatePicker
                  value={date}
                  onValueChange={(value) => setDate(value ?? todayKey())}
                  aria-label="Entry date"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDate(todayKey())}
                >
                  Today
                </Button>
              </div>
            </FormField>
            <FormField
              label="Description"
              htmlFor="finance-descriptor"
              className="sm:col-span-2"
            >
              <Input
                id="finance-descriptor"
                value={descriptor}
                onChange={(event) => setDescriptor(event.target.value)}
              />
            </FormField>
            <FormField
              label="Note"
              htmlFor="finance-note"
              className="sm:col-span-2"
            >
              <Textarea
                id="finance-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={3}
              />
            </FormField>
          </FormGrid>
        </EntryFormBody>
      </TabsContent>

      <TabsContent value="expected">
        <EntryFormBody
          onSubmit={() => void saveExpected()}
          actions={
            <Button type="submit" disabled={saving || !ready}>
              {spinner}
              Add expected
            </Button>
          }
        >
          <DirectionToggle value={direction} onChange={setDirection} />
          <FormGrid>
            {amountFields("expected-amount", false)}
            {accountSelect}
            <FormField label="Expected on">
              <DatePicker
                value={date}
                onValueChange={(value) => setDate(value ?? todayKey())}
                aria-label="Expected date"
              />
            </FormField>
            <FormField
              label="Description"
              htmlFor="expected-descriptor"
              className="sm:col-span-2"
            >
              <Input
                id="expected-descriptor"
                value={descriptor}
                onChange={(event) => setDescriptor(event.target.value)}
              />
            </FormField>
            <FormField label="Category">
              <CategoryField
                value={category}
                onValueChange={setCategory}
                categories={categories}
              />
            </FormField>
            <FormField label="Match window (days)" htmlFor="expected-window">
              <Input
                id="expected-window"
                type="number"
                min={0}
                max={60}
                value={windowDays}
                onChange={(event) => setWindowDays(event.target.value)}
                className="tabular-nums"
              />
            </FormField>
          </FormGrid>
        </EntryFormBody>
      </TabsContent>

      <TabsContent value="quick">
        <EntryFormBody
          onSubmit={() => void saveNatural()}
          actions={
            <Button
              type="submit"
              disabled={saving || !phrase.trim() || !account}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Sparkles />}
              Parse
            </Button>
          }
        >
          <FormField label="Phrase" htmlFor="finance-phrase">
            <Textarea
              id="finance-phrase"
              value={phrase}
              onChange={(event) => setPhrase(event.target.value)}
              rows={3}
              placeholder="lunch 12.40 yesterday"
            />
          </FormField>
          <FormGrid>{accountSelect}</FormGrid>
        </EntryFormBody>
      </TabsContent>
    </Tabs>
  );
}

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
      <Section
        title="Matched"
        actions={
          <span className="text-xs text-muted-foreground">
            {entry.matchMethod ?? "—"}
          </span>
        }
      >
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <span className="min-w-0 flex-1 truncate text-accent-strong">
            {linked
              ? `${shortDay(linked.effectiveDate)} · ${linked.descriptor}`
              : "Linked entry"}
          </span>
          {linked && (
            <span className="shrink-0 tabular-nums text-accent-strong">
              {money(linked.amountMinor, linked.currency)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              void run(() => unlinkFinanceEntry(client, entry.id), "Unlinked")
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : <Unlink />}
            Unlink
          </Button>
        </div>
      </Section>
    );
  }

  if (entry.origin === "bank") return null;

  return (
    <Section title="Match to transaction">
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">
          <SearchSelect
            value={choice}
            onValueChange={setChoice}
            options={candidates}
            placeholder="Pick a transaction"
            searchPlaceholder="Search transactions"
            emptyLabel="Nothing unmatched"
            aria-label="Bank transaction to match"
          />
        </div>
        <Button
          variant="outline"
          disabled={busy || !choice}
          onClick={() =>
            void run(
              () => linkFinanceEntry(client, entry.id, choice),
              "Entries matched",
            )
          }
        >
          {busy ? <Loader2 className="animate-spin" /> : <Link2 />}
          Match
        </Button>
      </div>
    </Section>
  );
}

/**
 * Editing an existing entry. Bank rows expose only the category — their amount,
 * date and descriptor are the provider's record and the next sync would
 * overwrite any local edit, so the server rejects those fields outright.
 */
export function EntryDetail({
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
  /** Leaves the entry — a page navigates away where a sheet just closed. */
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [category, setCategory] = useState<string | undefined>();
  const [descriptor, setDescriptor] = useState("");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<Direction>("expense");
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
  // A cleared amount is `Number("") === 0` and a junk one is `NaN`, which
  // serializes to null and comes back as a generic server error.
  const ready =
    readOnly || (positiveAmount(amount) && descriptor.trim().length > 0);
  const deletable =
    entry !== null &&
    entry.origin !== "bank" &&
    !(entry.origin === "projected" && entry.recurringRuleId);
  const accountName = entry
    ? (accounts.find((item) => item.id === entry.accountId)?.displayName ?? "—")
    : "";

  async function save() {
    if (!entry || !ready || saving) return;
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

  async function remove() {
    if (!entry) return;
    try {
      await deleteFinanceEntry(client, entry.id);
      toast.success("Entry deleted");
      onClose();
      await onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed");
    }
  }

  if (!entry) return null;

  return (
    <>
      <PageTitle
        title={entry.descriptor}
        meta={
          <>
            <span>{accountName}</span>
            <span>
              {entry.origin}
              {entry.origin === "projected" && !entry.recurringRuleId
                ? " · one-off"
                : ""}
            </span>
            <span className="tabular-nums">
              {shortDay(entry.effectiveDate)}
            </span>
          </>
        }
        actions={
          <span
            className={cn(
              "font-calistoga text-2xl tabular-nums",
              entry.amountMinor > 0 ? "text-status-good" : "text-accent-strong",
            )}
          >
            {money(entry.amountMinor, entry.currency)}
          </span>
        }
      />

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Properties>
          <Property label="Category">
            <CategoryField
              value={category}
              onValueChange={setCategory}
              categories={categories}
              extra={entry.category}
            />
          </Property>
          <Property label="Apply to merchant">
            <Switch
              id="entry-apply-merchant"
              aria-label="Apply to this merchant"
              checked={applyToMerchant}
              onCheckedChange={setApplyToMerchant}
            />
          </Property>
          {!readOnly && (
            <>
              <Property label="Direction">
                <DirectionToggle value={direction} onChange={setDirection} />
              </Property>
              <Property label={`Amount (${entry.currency})`}>
                <Input
                  id="entry-amount"
                  aria-label="Amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="font-medium tabular-nums"
                />
              </Property>
              <Property label="Description">
                <Input
                  id="entry-descriptor"
                  aria-label="Description"
                  value={descriptor}
                  onChange={(event) => setDescriptor(event.target.value)}
                />
              </Property>
              <Property label="Date">
                <DatePicker
                  value={date}
                  onValueChange={(value) => setDate(value ?? todayKey())}
                  aria-label="Entry date"
                />
              </Property>
              {entry.origin === "manual" && (
                <Property label="Note" className="items-start">
                  <Textarea
                    id="entry-note"
                    aria-label="Note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={3}
                  />
                </Property>
              )}
            </>
          )}
        </Properties>

        <div className="flex items-center gap-2 border-t pt-4">
          {deletable && (
            <ConfirmButton
              title={`Delete ${entry.descriptor}?`}
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
          )}
          <Button type="submit" className="ml-auto" disabled={saving || !ready}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </form>

      <MatchSection entry={entry} ledger={ledger} onSaved={onSaved} />
    </>
  );
}
