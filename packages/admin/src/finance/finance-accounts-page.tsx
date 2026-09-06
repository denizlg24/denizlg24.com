"use client";

import type { FinanceAccount, FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { StatusDot } from "@repo/ui/status-dot";
import { Switch } from "@repo/ui/switch";
import { Landmark, Loader2, Unlink } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { disconnectFinanceAccount, updateFinanceAccount } from "./finance-data";
import {
  CONNECTION_TONE,
  Empty,
  FieldRow,
  relative,
} from "./finance-primitives";

const ICON = <Landmark className="size-4 text-muted-foreground" />;

/**
 * The linked-account list, and one account's settings when the URL names one.
 *
 * Both were a sheet over the finance dashboard, which is why the fetch-budget
 * controls sat in a column narrower than the numbers they govern.
 */
export function FinanceAccountsPage({
  accountId,
}: {
  /** Absent shows the list. */
  accountId?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const [accounts, setAccounts] = useState<FinanceAccount[] | null>(null);

  const load = useCallback(async () => {
    try {
      const dashboard = await client.get<FinanceDashboardResponse>("finance");
      setAccounts(dashboard.accounts);
    } catch {
      toast.error("Failed to load accounts");
      setAccounts([]);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const shell = {
    icon: ICON,
    backTo: accountId ? routes.finance.accounts : routes.finance.root,
    backLabel: accountId ? "Accounts" : "Finance",
  } as const;

  if (accounts === null) {
    return <DetailPageSkeleton {...shell} title="Accounts" rows={2} />;
  }

  if (accountId) {
    const account = accounts.find((row) => row.id === accountId);
    if (!account) {
      return (
        <DetailNotFound
          {...shell}
          title="Account not found"
          message="This account could not be loaded."
        />
      );
    }
    return (
      <DetailPageShell {...shell} title={account.displayName}>
        <AccountSettings
          account={account}
          onClose={() => router.push(routes.finance.accounts)}
          onSaved={load}
        />
      </DetailPageShell>
    );
  }

  return (
    <DetailPageShell {...shell} title="Accounts">
      {accounts.length === 0 ? (
        <Empty label="—" />
      ) : (
        <div>
          {accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => router.push(routes.finance.account(account.id))}
              className="flex w-full items-center gap-3 border-b border-border/60 py-3 text-left last:border-b-0 hover:bg-muted/40"
            >
              <StatusDot
                tone={CONNECTION_TONE[account.connection.status]}
                label={account.connection.status}
              />
              <span className="min-w-0 flex-1 truncate text-[13px]">
                {account.displayName}
              </span>
              <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                {account.institutionName}
              </span>
              <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                {account.connection.accessValidUntil
                  ? `expires ${relative(account.connection.accessValidUntil)}`
                  : account.connection.status}
              </span>
            </button>
          ))}
        </div>
      )}
    </DetailPageShell>
  );
}

function AccountSettings({
  account,
  onClose,
  onSaved,
}: {
  account: FinanceAccount | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [displayName, setDisplayName] = useState("");
  const [dailyLimit, setDailyLimit] = useState(4);
  const [reserve, setReserve] = useState(1);
  const [timezone, setTimezone] = useState("UTC");
  const [countsFailed, setCountsFailed] = useState(true);
  const [attendedExempt, setAttendedExempt] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!account) return;
    setDisplayName(account.displayName);
    setDailyLimit(account.budget.dailyFetchLimit);
    setReserve(account.budget.reservedManualFetches);
    setTimezone(account.budget.budgetTimezone);
    setCountsFailed(account.budget.countsFailedAttempts);
    setAttendedExempt(account.budget.attendedCallsExempt);
  }, [account]);

  if (!account) return null;

  return (
    <div className="space-y-6">
      <p className="text-xs text-muted-foreground">{account.institutionName}</p>
      {account && (
        <div className="space-y-6">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Connection</span>
            <span className="flex items-center gap-2">
              <StatusDot
                tone={CONNECTION_TONE[account.connection.status]}
                label={account.connection.status.replaceAll("_", " ")}
              />
              {account.connection.status.replaceAll("_", " ")}
            </span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Access valid until</span>
            <span className="tabular-nums">
              {account.connection.accessValidUntil
                ? relative(account.connection.accessValidUntil)
                : "—"}
            </span>
          </div>

          <FieldRow label="Name" htmlFor="account-name">
            <Input
              id="account-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </FieldRow>

          <div className="grid grid-cols-2 gap-3">
            <FieldRow label="Daily limit" htmlFor="account-limit">
              <Input
                id="account-limit"
                type="number"
                min={1}
                value={dailyLimit}
                className="tabular-nums"
                onChange={(event) => setDailyLimit(Number(event.target.value))}
              />
            </FieldRow>
            <FieldRow label="Manual reserve" htmlFor="account-reserve">
              <Input
                id="account-reserve"
                type="number"
                min={0}
                value={reserve}
                className="tabular-nums"
                aria-invalid={reserve >= dailyLimit}
                onChange={(event) => setReserve(Number(event.target.value))}
              />
            </FieldRow>
          </div>
          <FieldRow label="Budget timezone" htmlFor="account-tz">
            <Input
              id="account-tz"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </FieldRow>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label htmlFor="account-failed" className="text-xs font-normal">
                Count failed attempts
              </Label>
              <Switch
                id="account-failed"
                checked={countsFailed}
                onCheckedChange={setCountsFailed}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="account-attended" className="text-xs font-normal">
                Attended calls exempt
              </Label>
              <Switch
                id="account-attended"
                checked={attendedExempt}
                onCheckedChange={setAttendedExempt}
              />
            </div>
          </div>

          <Button
            className="w-full"
            disabled={saving || reserve >= dailyLimit || !displayName.trim()}
            onClick={async () => {
              setSaving(true);
              try {
                await updateFinanceAccount(client, account.id, {
                  displayName: displayName.trim(),
                  dailyFetchLimit: dailyLimit,
                  reservedManualFetches: reserve,
                  budgetTimezone: timezone,
                  countsFailedAttempts: countsFailed,
                  attendedCallsExempt: attendedExempt,
                });
                toast.success("Account updated");
                await onSaved();
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Update failed",
                );
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>

          <ConfirmButton
            title={`Disconnect ${account.displayName}?`}
            actionLabel="Disconnect"
            onConfirm={async () => {
              try {
                await disconnectFinanceAccount(client, account.id);
                toast.success("Account disconnected");
                await onSaved();
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Disconnect failed",
                );
              }
            }}
            trigger={
              <Button variant="ghost" className="w-full text-destructive">
                <Unlink className="size-4" />
                Disconnect
              </Button>
            }
          />
        </div>
      )}
    </div>
  );
}
