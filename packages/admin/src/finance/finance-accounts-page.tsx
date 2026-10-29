"use client";

import type { FinanceAccount, FinanceDashboardResponse } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { PageTitle } from "@repo/ui/page";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
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
import { CONNECTION_TONE, relative } from "./finance-primitives";

const ICON = <Landmark />;

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
      <DetailPageShell {...shell} title="Account">
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
        <EmptyState icon={<Landmark />} label="No accounts" />
      ) : (
        <Section title="Accounts" count={accounts.length}>
          <List divided>
            {accounts.map((account) => (
              <ListRow
                key={account.id}
                onClick={() => router.push(routes.finance.account(account.id))}
                leading={
                  <StatusDot
                    tone={CONNECTION_TONE[account.connection.status]}
                    label={account.connection.status.replaceAll("_", " ")}
                  />
                }
                title={account.displayName}
                description={account.institutionName}
                meta={
                  account.connection.accessValidUntil
                    ? `expires ${relative(account.connection.accessValidUntil)}`
                    : account.connection.status.replaceAll("_", " ")
                }
              />
            ))}
          </List>
        </Section>
      )}
    </DetailPageShell>
  );
}

function AccountSettings({
  account,
  onClose,
  onSaved,
}: {
  account: FinanceAccount;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const { client } = useAdmin();
  const [displayName, setDisplayName] = useState(account.displayName);
  const [dailyLimit, setDailyLimit] = useState(account.budget.dailyFetchLimit);
  const [reserve, setReserve] = useState(account.budget.reservedManualFetches);
  const [timezone, setTimezone] = useState(account.budget.budgetTimezone);
  const [countsFailed, setCountsFailed] = useState(
    account.budget.countsFailedAttempts,
  );
  const [attendedExempt, setAttendedExempt] = useState(
    account.budget.attendedCallsExempt,
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(account.displayName);
    setDailyLimit(account.budget.dailyFetchLimit);
    setReserve(account.budget.reservedManualFetches);
    setTimezone(account.budget.budgetTimezone);
    setCountsFailed(account.budget.countsFailedAttempts);
    setAttendedExempt(account.budget.attendedCallsExempt);
  }, [account]);

  const status = account.connection.status.replaceAll("_", " ");
  const limitValid = Number.isInteger(dailyLimit) && dailyLimit >= 1;
  const reserveValid =
    Number.isInteger(reserve) && reserve >= 0 && reserve < dailyLimit;
  const ready =
    limitValid && reserveValid && displayName.trim().length > 0 && !saving;

  async function save() {
    if (!ready) return;
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
      toast.error(error instanceof Error ? error.message : "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    try {
      await disconnectFinanceAccount(client, account.id);
      toast.success("Account disconnected");
      await onSaved();
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Disconnect failed");
    }
  }

  return (
    <>
      <PageTitle
        title={account.displayName}
        meta={
          <>
            <span>{account.institutionName}</span>
            <span className="flex items-center gap-1.5">
              <StatusDot
                tone={CONNECTION_TONE[account.connection.status]}
                label={status}
              />
              {status}
            </span>
          </>
        }
      />

      <Properties>
        <Property label="Currency">{account.currency}</Property>
        <Property label="Access until">
          <span className="tabular-nums">
            {account.connection.accessValidUntil
              ? relative(account.connection.accessValidUntil)
              : "—"}
          </span>
        </Property>
        <Property label="Fetches today">
          <span className="tabular-nums">
            {account.budget.fetchesUsed}/{account.budget.dailyFetchLimit}
          </span>
        </Property>
        <Property label="Last synced">
          <span className="tabular-nums">{relative(account.lastSyncedAt)}</span>
        </Property>
      </Properties>

      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Section title="Settings">
          <FormGrid>
            <FormField
              label="Name"
              htmlFor="account-name"
              className="sm:col-span-2"
            >
              <Input
                id="account-name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </FormField>
            <FormField label="Daily limit" htmlFor="account-limit">
              <Input
                id="account-limit"
                type="number"
                min={1}
                value={dailyLimit}
                className="tabular-nums"
                aria-invalid={!limitValid}
                onChange={(event) => setDailyLimit(Number(event.target.value))}
              />
            </FormField>
            <FormField
              label="Manual reserve"
              htmlFor="account-reserve"
              error={
                limitValid && !reserveValid
                  ? "Must be below the daily limit"
                  : undefined
              }
            >
              <Input
                id="account-reserve"
                type="number"
                min={0}
                value={reserve}
                className="tabular-nums"
                aria-invalid={!reserveValid}
                onChange={(event) => setReserve(Number(event.target.value))}
              />
            </FormField>
            <FormField
              label="Budget timezone"
              htmlFor="account-tz"
              className="sm:col-span-2"
            >
              <Input
                id="account-tz"
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              />
            </FormField>
          </FormGrid>
          <Properties>
            <Property label="Count failed attempts">
              <Switch
                id="account-failed"
                aria-label="Count failed attempts"
                checked={countsFailed}
                onCheckedChange={setCountsFailed}
              />
            </Property>
            <Property label="Attended calls exempt">
              <Switch
                id="account-attended"
                aria-label="Attended calls exempt"
                checked={attendedExempt}
                onCheckedChange={setAttendedExempt}
              />
            </Property>
          </Properties>
        </Section>

        <div className="flex items-center gap-2 border-t pt-4">
          <ConfirmButton
            title={`Disconnect ${account.displayName}?`}
            actionLabel="Disconnect"
            destructive
            onConfirm={disconnect}
            trigger={
              <Button
                type="button"
                variant="ghost"
                className="text-muted-foreground hover:text-destructive"
              >
                <Unlink />
                Disconnect
              </Button>
            }
          />
          <Button type="submit" className="ml-auto" disabled={!ready}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </>
  );
}
