"use client";

import { Download, KeyRound, Loader2, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AddAccountDialog } from "./_components/add-account-dialog";
import { AuthenticatorAccountRow } from "./_components/authenticator-account";
import { ImportDialog } from "./_components/import-dialog";
import type {
  IAuthenticatorAccount,
  IAuthenticatorCode,
  TotpAlgorithm,
} from "./types";

export default function AuthenticatorPage() {
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
    const res = await fetch("/api/admin/authenticator/codes");
    if (res.ok) {
      const data: { codes: IAuthenticatorCode[] } = await res.json();
      setCodes(data.codes);
    }
  }, []);

  useEffect(() => {
    if (!initialLoading) return;

    const load = async () => {
      const res = await fetch("/api/admin/authenticator");
      if (res.ok) {
        const data: { accounts: IAuthenticatorAccount[] } = await res.json();
        setAccounts(data.accounts ?? []);
      }
      await fetchCodes();
      setInitialLoading(false);
    };

    load();
  }, [initialLoading, fetchCodes]);

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
    const res = await fetch("/api/admin/authenticator", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      toast.error("Failed to add account");
      return;
    }
    const result: { account: IAuthenticatorAccount } = await res.json();
    setAccounts((prev) => [result.account, ...prev]);
    setAddOpen(false);
    toast.success("Account added");
    fetchCodes();
  };

  const handleEdit = async (data: {
    label: string;
    issuer: string;
    accountName: string;
  }) => {
    if (!editingAccount) return;
    const res = await fetch(`/api/admin/authenticator/${editingAccount._id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: data.label,
        issuer: data.issuer,
        accountName: data.accountName,
      }),
    });
    if (!res.ok) {
      toast.error("Failed to update account");
      return;
    }
    const result: { account: IAuthenticatorAccount } = await res.json();
    setAccounts((prev) =>
      prev.map((a) => (a._id === editingAccount._id ? result.account : a)),
    );
    setEditingAccount(null);
    toast.success("Account updated");
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await fetch(`/api/admin/authenticator/${deleteTarget._id}`, {
      method: "DELETE",
    });
    setDeleting(false);
    if (!res.ok) {
      toast.error("Failed to delete account");
      return;
    }
    setAccounts((prev) => prev.filter((a) => a._id !== deleteTarget._id));
    setDeleteTarget(null);
    toast.success("Account deleted");
  };

  const handleImport = async (uris: string[]) => {
    const res = await fetch("/api/admin/authenticator/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uris }),
    });
    if (!res.ok) {
      toast.error("Import failed");
      return;
    }
    const result: {
      imported: IAuthenticatorAccount[];
      errors: { uri: string; error: string }[];
    } = await res.json();
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
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <div className="h-4 w-32 bg-muted rounded animate-pulse flex-1" />
          <div className="h-7 w-24 bg-muted rounded animate-pulse" />
        </div>
        <div className="flex-1 overflow-auto">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 px-4 py-3 border-b border-border/50"
            >
              <div className="flex-1 flex flex-col gap-1.5">
                <div className="h-3.5 w-28 bg-muted rounded animate-pulse" />
                <div className="h-2.5 w-40 bg-muted rounded animate-pulse" />
              </div>
              <div className="h-5 w-30 bg-muted rounded animate-pulse" />
              <div className="size-8 bg-muted rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Authenticator</span>

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
      </div>

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
