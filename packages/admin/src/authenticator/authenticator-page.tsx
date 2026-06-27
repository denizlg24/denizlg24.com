"use client";

import type {
  IAuthenticatorAccount,
  IAuthenticatorCode,
  TotpAlgorithm,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Input } from "@repo/ui/input";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { Download, KeyRound, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { AddAccountDialog } from "./add-account-dialog";
import { AuthenticatorAccountRow } from "./authenticator-account";
import { ImportDialog } from "./import-dialog";

export function AuthenticatorSkeleton() {
  return (
    <div className="flex flex-col h-full">
      <HeaderBarSkeleton
        icon={<KeyRound className="size-4 text-muted-foreground" />}
        title="Authenticator"
        actions={["w-20", "w-16"]}
      />
      <div className="flex-1 overflow-auto">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 px-4 py-3 border-b border-border/50"
          >
            <div className="flex-1 flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-2.5 w-40" />
            </div>
            <Skeleton className="h-5 w-30" />
            <Skeleton className="size-8 rounded-full" />
          </div>
        ))}
      </div>
    </div>
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
  const [deleting, setDeleting] = useState(false);

  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        if (!cancelled) setAccounts(result.accounts ?? []);
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
    } catch {
      toast.error("Failed to add account");
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

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await client.del(`authenticator/${deleteTarget._id}`);
      setAccounts((prev) => prev.filter((a) => a._id !== deleteTarget._id));
      setDeleteTarget(null);
      toast.success("Account deleted");
    } catch {
      toast.error("Failed to delete account");
    } finally {
      setDeleting(false);
    }
  };

  const handleImport = async (uris: string[]) => {
    try {
      const result = await client.post<{
        imported: IAuthenticatorAccount[];
        errors: { uri: string; error: string }[];
      }>("authenticator/import", { uris });
      setAccounts((prev) => [...result.imported, ...prev]);
      setImportOpen(false);
      fetchCodes();

      if (result.errors.length > 0) {
        toast.warning(
          `Imported ${result.imported.length}, failed ${result.errors.length}`,
        );
      } else {
        toast.success(`Imported ${result.imported.length} account(s)`);
      }
    } catch {
      toast.error("Import failed");
    }
  };

  const filtered = search.trim()
    ? accounts.filter(
        (a) =>
          a.label.toLowerCase().includes(search.toLowerCase()) ||
          a.issuer.toLowerCase().includes(search.toLowerCase()) ||
          a.accountName.toLowerCase().includes(search.toLowerCase()),
      )
    : accounts;

  if (initialLoading) {
    return <AuthenticatorSkeleton />;
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<KeyRound className="size-4 text-muted-foreground" />}
        title="Authenticator"
      >
        <div className="hidden sm:flex items-center gap-3 mr-3 text-xs">
          <span className="font-mono text-muted-foreground/70 tabular-nums">
            {accounts.length}{" "}
            <span className="text-[9px] uppercase tracking-wider">
              account{accounts.length !== 1 ? "s" : ""}
            </span>
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => setImportOpen(true)}
          className="gap-1.5 text-muted-foreground"
        >
          <Download className="size-3" />
          Import
        </Button>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="size-3" /> Add
        </Button>
      </PageHeader>

      {accounts.length > 0 && (
        <div className="px-4 py-2 border-b border-border/50">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              placeholder="Search accounts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>
      )}

      {accounts.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground/60">
          <KeyRound className="size-8 opacity-30" />
          <p className="text-sm">No authenticator accounts yet</p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              <Download className="size-3" /> Import
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-3" /> Add Account
            </Button>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/60">
          <Search className="size-6 opacity-30" />
          <p className="text-sm">No matches for &quot;{search}&quot;</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {filtered.map((account) => (
            <AuthenticatorAccountRow
              key={account._id}
              account={account}
              codeData={codes.find((c) => c._id === account._id)}
              onEdit={() => setEditingAccount(account)}
              onDelete={() => setDeleteTarget(account)}
            />
          ))}
        </div>
      )}

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

      <Dialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Delete &quot;{deleteTarget?.label}&quot;? The TOTP secret will be
              permanently removed and cannot be recovered.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Deleting...
                </>
              ) : (
                "Delete Account"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
