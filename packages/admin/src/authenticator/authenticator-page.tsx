"use client";

import type {
  IAuthenticatorAccount,
  IAuthenticatorCode,
  TotpAlgorithm,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmDialog } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { List } from "@repo/ui/list";
import { Page, PageBody, PageHeader, PageToolbar } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { SearchField, ToolbarSpacer } from "@repo/ui/toolbar";
import { Download, KeyRound, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { AddAccountDialog } from "./add-account-dialog";
import { AuthenticatorAccountRow } from "./authenticator-account";
import { ImportDialog } from "./import-dialog";

export function AuthenticatorSkeleton() {
  const { slots } = useAdmin();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<KeyRound />}
        title="Authenticator"
      >
        <Skeleton className="h-7 w-20" />
        <Skeleton className="h-7 w-16" />
      </PageHeader>
      <PageToolbar>
        <Skeleton className="h-7 w-56" />
      </PageToolbar>
      <PageBody>
        <div className="flex flex-col">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex min-h-14 items-center gap-3 border-b border-border/70 py-2.5"
            >
              <div className="flex flex-1 flex-col gap-1.5">
                <Skeleton className="h-3.5 w-28" />
                <Skeleton className="h-2.5 w-40" />
              </div>
              <Skeleton className="h-5 w-28" />
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="size-7" />
            </div>
          ))}
        </div>
      </PageBody>
    </Page>
  );
}

export function AuthenticatorPage() {
  const { client, slots } = useAdmin();

  const [accounts, setAccounts] = useState<IAuthenticatorAccount[]>([]);
  const [codes, setCodes] = useState<IAuthenticatorCode[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editingAccount, setEditingAccount] =
    useState<IAuthenticatorAccount | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<IAuthenticatorAccount | null>(null);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const accountsLoadedRef = useRef(false);

  const fetchCodes = useCallback(async () => {
    try {
      const result = await client.get<{ codes: IAuthenticatorCode[] }>(
        "authenticator/codes",
      );
      setCodes(result.codes);
    } catch {
      // Codes refresh every second; a transient failure self-heals on the next tick.
    }
  }, [client]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await client.get<{ accounts: IAuthenticatorAccount[] }>(
          "authenticator",
        );
        if (!cancelled) {
          setAccounts(result.accounts ?? []);
          accountsLoadedRef.current = true;
        }
      } catch {
        if (!cancelled) toast.error("Failed to load accounts");
      }
      await fetchCodes();
      if (!cancelled) setInitialLoading(false);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [client, fetchCodes]);

  useEffect(() => {
    if (initialLoading) return;

    pollingRef.current = setInterval(fetchCodes, 1000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [initialLoading, fetchCodes]);

  const handleAdd = async (data: {
    label: string;
    issuer: string;
    accountName: string;
    secret?: string;
    algorithm: TotpAlgorithm;
    digits: number;
    period: number;
  }) => {
    if (!data.secret) return;
    try {
      const result = await client.post<{ account: IAuthenticatorAccount }>(
        "authenticator",
        data,
      );
      setAccounts((prev) => [result.account, ...prev]);
      setAddOpen(false);
      toast.success("Account added");
      fetchCodes();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to add account",
      );
    }
  };

  const handleEdit = async (data: {
    label: string;
    issuer: string;
    accountName: string;
  }) => {
    if (!editingAccount) return;
    try {
      const result = await client.patch<{ account: IAuthenticatorAccount }>(
        `authenticator/${editingAccount._id}`,
        {
          label: data.label,
          issuer: data.issuer,
          accountName: data.accountName,
        },
      );
      setAccounts((prev) =>
        prev.map((a) => (a._id === editingAccount._id ? result.account : a)),
      );
      setEditingAccount(null);
      toast.success("Account updated");
    } catch {
      toast.error("Failed to update account");
    }
  };

  const handleDelete = async (target: IAuthenticatorAccount) => {
    try {
      await client.del(`authenticator/${target._id}`);
      setAccounts((prev) => prev.filter((a) => a._id !== target._id));
      toast.success("Account deleted");
    } catch {
      toast.error("Failed to delete account");
    }
  };

  const handleImport = async (uris: string[]) => {
    const knownIds = accountsLoadedRef.current
      ? new Set(accounts.map((account) => account._id))
      : null;
    try {
      const result = await client.post<{
        imported: IAuthenticatorAccount[];
        errors: { uri: string; error: string }[];
      }>("authenticator/import", { uris });
      if (result.imported.length > 0) {
        setAccounts((prev) => [...result.imported, ...prev]);
        setImportOpen(false);
        void fetchCodes();
      }

      if (result.errors.length > 0) {
        const detail = result.errors[0]?.error;
        toast.warning(
          `Imported ${result.imported.length}, failed ${result.errors.length}${detail ? `: ${detail}` : ""}`,
        );
      } else {
        toast.success(`Imported ${result.imported.length} account(s)`);
      }
    } catch (error) {
      // An upstream error can arrive after the account has been written. Read
      // the vault before telling the user the import failed or inviting a retry.
      if (knownIds) {
        try {
          const refreshed = await client.get<{
            accounts: IAuthenticatorAccount[];
          }>("authenticator");
          const imported = refreshed.accounts.filter(
            (account) => !knownIds.has(account._id),
          );
          setAccounts(refreshed.accounts);
          accountsLoadedRef.current = true;
          if (imported.length > 0) {
            setImportOpen(false);
            void fetchCodes();
            toast.success(
              `Imported ${imported.length} account${imported.length === 1 ? "" : "s"}`,
            );
            return;
          }
        } catch {
          // Keep the original import error when the recovery read also fails.
        }
      }
      toast.error(error instanceof Error ? error.message : "Import failed");
    }
  };

  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? accounts.filter(
        (a) =>
          a.label.toLowerCase().includes(needle) ||
          a.issuer.toLowerCase().includes(needle) ||
          a.accountName.toLowerCase().includes(needle),
      )
    : accounts;

  if (initialLoading) {
    return <AuthenticatorSkeleton />;
  }

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<KeyRound />}
        title="Authenticator"
      >
        <Button variant="ghost" size="sm" onClick={() => setImportOpen(true)}>
          <Download /> Import
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus /> Add
        </Button>
      </PageHeader>

      {accounts.length > 0 && (
        <PageToolbar>
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Search accounts"
            className="w-64"
          />
          <ToolbarSpacer />
          <span className="text-xs tabular-nums text-muted-foreground">
            {needle ? `${filtered.length}/${accounts.length}` : accounts.length}
          </span>
        </PageToolbar>
      )}

      <PageBody>
        {accounts.length === 0 ? (
          <EmptyState
            icon={<KeyRound />}
            label="No accounts"
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportOpen(true)}
              >
                <Download /> Import
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState label="0 results" />
        ) : (
          <List divided>
            {filtered.map((account) => (
              <AuthenticatorAccountRow
                key={account._id}
                account={account}
                codeData={codes.find((c) => c._id === account._id)}
                onEdit={() => setEditingAccount(account)}
                onDelete={() => setDeleteTarget(account)}
              />
            ))}
          </List>
        )}
      </PageBody>

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onSubmit={handleAdd}
        key="add-dialog"
      />

      <AddAccountDialog
        open={!!editingAccount}
        onOpenChange={(o) => !o && setEditingAccount(null)}
        onSubmit={handleEdit}
        editing={editingAccount}
        key={editingAccount?._id ?? "edit-dialog"}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={handleImport}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.label ?? "account"}?`}
        description="The secret cannot be recovered."
        actionLabel="Delete"
        destructive
        onConfirm={() => {
          if (deleteTarget) void handleDelete(deleteTarget);
        }}
      />
    </Page>
  );
}
