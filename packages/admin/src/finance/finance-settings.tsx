"use client";

import type { FinanceCategory, FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CurrencySelect } from "@repo/ui/currency-select";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { cn } from "@repo/ui/utils";
import { formatMoney } from "@repo/utils";
import { Check, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { SettingsGroup, SettingsRow } from "../settings/settings-shell";
import {
  createFinanceCategory,
  deleteFinanceCategory,
  refreshFinanceFxRates,
  updateFinanceCategory,
  updateFinanceSettings,
} from "./finance-data";
import { Empty, relative } from "./finance-primitives";

function CategoryRow({
  category,
  categories,
  usage,
  onChanged,
}: {
  category: FinanceCategory;
  categories: FinanceCategory[];
  usage: number;
  onChanged: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const [reassignTo, setReassignTo] = useState("");
  const [busy, setBusy] = useState(false);

  async function rename() {
    const next = name.trim();
    if (!next || next === category.name) {
      setEditing(false);
      setName(category.name);
      return;
    }
    setBusy(true);
    try {
      await updateFinanceCategory(client, category.id, { name: next });
      setEditing(false);
      await onChanged();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Rename failed");
      setName(category.name);
    } finally {
      setBusy(false);
    }
  }

  const others = categories.filter((item) => item.id !== category.id);

  return (
    <div className="group flex items-center gap-3 py-2">
      {editing ? (
        <>
          <Input
            value={name}
            autoFocus
            className="h-7 min-w-0 flex-1 text-sm"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rename();
              if (event.key === "Escape") {
                setEditing(false);
                setName(category.name);
              }
            }}
          />
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Save name"
            disabled={busy}
            onClick={() => void rename()}
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Cancel"
            onClick={() => {
              setEditing(false);
              setName(category.name);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </>
      ) : (
        <>
          <button
            type="button"
            className="min-w-0 flex-1 truncate text-left text-sm transition-opacity hover:opacity-70"
            onClick={() => setEditing(true)}
          >
            {category.name}
          </button>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {usage}
          </span>
          <ConfirmButton
            title={`Delete ${category.name}?`}
            description={
              usage > 0
                ? `${usage} ${usage === 1 ? "entry uses" : "entries use"} it. Leave the replacement empty to make them uncategorized.`
                : undefined
            }
            actionLabel="Delete"
            body={
              others.length > 0 ? (
                <Select value={reassignTo} onValueChange={setReassignTo}>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder="Uncategorized" />
                  </SelectTrigger>
                  <SelectContent>
                    {others.map((item) => (
                      <SelectItem key={item.id} value={item.name}>
                        Move to {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : undefined
            }
            onConfirm={async () => {
              try {
                await deleteFinanceCategory(
                  client,
                  category.id,
                  reassignTo || undefined,
                );
                await onChanged();
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Delete failed",
                );
              }
            }}
            trigger={
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={`Delete ${category.name}`}
                className="shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 className="size-3.5" />
              </Button>
            }
          />
        </>
      )}
    </div>
  );
}

export function FinanceSettingsForm({
  data,
  onReload,
}: {
  data: FinanceDashboardResponse;
  onReload: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [baseCurrency, setBaseCurrency] = useState(data.settings.baseCurrency);
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [newCategory, setNewCategory] = useState("");
  const [creating, setCreating] = useState(false);

  const usage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of data.ledger) {
      if (!entry.category) continue;
      counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
    }
    return counts;
  }, [data.ledger]);

  const unconverted = data.aggregateBalances.filter(
    (balance) => balance.currency !== data.settings.baseCurrency,
  );

  async function saveCurrency() {
    if (baseCurrency === data.settings.baseCurrency) return;
    setSavingCurrency(true);
    try {
      await updateFinanceSettings(client, { baseCurrency });
      toast.success(`Dashboard pinned to ${baseCurrency}`);
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update failed");
      setBaseCurrency(data.settings.baseCurrency);
    } finally {
      setSavingCurrency(false);
    }
  }

  async function refreshRates() {
    setRefreshing(true);
    try {
      const result = await refreshFinanceFxRates(client);
      if (result.unsupported.length > 0) {
        toast.warning(
          `${result.updated} rates · no rate for ${result.unsupported.join(", ")}`,
        );
      } else {
        toast.success(`${result.updated} rates updated`);
      }
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  async function addCategory() {
    const name = newCategory.trim();
    if (!name) return;
    setCreating(true);
    try {
      await createFinanceCategory(client, { name });
      setNewCategory("");
      await onReload();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <SettingsGroup label="Currency">
        <div className="space-y-6">
          <SettingsRow
            label="Dashboard currency"
            hint="Everything on the finance dashboard is converted into this."
          >
            <div className="flex min-w-0 items-center gap-2">
              <CurrencySelect
                value={baseCurrency}
                onValueChange={setBaseCurrency}
                className="min-w-0 flex-1"
              />
              <Button
                variant="outline"
                className="shrink-0"
                disabled={
                  savingCurrency || baseCurrency === data.settings.baseCurrency
                }
                onClick={() => void saveCurrency()}
              >
                {savingCurrency && (
                  <Loader2 className="size-3.5 animate-spin" />
                )}
                Pin
              </Button>
            </div>
          </SettingsRow>

          <SettingsRow
            label="Exchange rates"
            hint={
              <span className="tabular-nums">
                {data.settings.fxSource} ·{" "}
                {data.settings.fxUpdatedAt
                  ? relative(data.settings.fxUpdatedAt)
                  : "never"}
              </span>
            }
          >
            <Button
              variant="outline"
              className="w-full"
              disabled={refreshing}
              onClick={() => void refreshRates()}
            >
              <RefreshCw
                className={cn("size-3.5", refreshing && "animate-spin")}
              />
              Refresh rates
            </Button>
          </SettingsRow>

          {unconverted.length > 0 && (
            <SettingsRow label="Unconverted" stacked>
              <div className="divide-y">
                {unconverted.map((balance) => (
                  <div
                    key={balance.currency}
                    className="flex items-baseline justify-between py-1.5 text-xs"
                  >
                    <span className="text-muted-foreground">
                      {balance.currency}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(balance.amountMinor, balance.currency, {
                        style: "decimal",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </SettingsRow>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        label="Categories"
        actions={
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {data.categories.length}
          </span>
        }
      >
        <div className="space-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <Input
              value={newCategory}
              placeholder="New category"
              className="h-9 min-w-0 flex-1"
              onChange={(event) => setNewCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void addCategory();
              }}
            />
            <Button
              variant="outline"
              className="shrink-0"
              aria-label="Add category"
              disabled={creating || !newCategory.trim()}
              onClick={() => void addCategory()}
            >
              {creating ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
            </Button>
          </div>
          {data.categories.length === 0 ? (
            <Empty label="—" compact />
          ) : (
            <div className="divide-y">
              {data.categories.map((category) => (
                <CategoryRow
                  key={category.id}
                  category={category}
                  categories={data.categories}
                  usage={usage.get(category.name) ?? 0}
                  onChanged={onReload}
                />
              ))}
            </div>
          )}
        </div>
      </SettingsGroup>
    </>
  );
}
