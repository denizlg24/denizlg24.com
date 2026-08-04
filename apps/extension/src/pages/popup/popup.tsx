import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Skeleton } from "@repo/ui/skeleton";
import {
  KeyRound,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccountRow } from "../../components/account-row";
import {
  AddAccountDialog,
  EditAccountDialog,
} from "../../components/add-account-dialog";
import { UnlockScreen } from "../../components/unlock-screen";
import { useCodes } from "../../hooks/use-codes";
import { useVaultState } from "../../hooks/use-vault-state";
import { openOptionsPage } from "../../lib/browser";
import { formatRelative } from "../../lib/format";
import { send } from "../../lib/messages";
import type { VaultEntry } from "../../lib/types";

function PopupShell({ children }: { children: React.ReactNode }) {
  return <div className="popup-root flex flex-col">{children}</div>;
}

function LoadingState() {
  return (
    <PopupShell>
      <div className="h-11 border-b border-border/50 flex items-center px-3 gap-2">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="flex-1">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex items-center gap-3 px-3 py-2.5 border-b border-border/50"
          >
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-2 w-32" />
            </div>
            <Skeleton className="h-4 w-20" />
            <Skeleton className="size-7 rounded-full" />
          </div>
        ))}
      </div>
    </PopupShell>
  );
}

export function Popup() {
  const { state, preferences, refresh, unlock, lock } = useVaultState();
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [syncing, setSyncing] = useState(false);
  const openedSync = useRef(false);

  const entries = state.status === "unlocked" ? state.payload.entries : [];
  const codes = useCodes(entries);

  // Opening the popup is the natural moment to look for accounts that were set
  // up elsewhere; failures stay silent because the codes work regardless.
  useEffect(() => {
    if (state.status !== "unlocked" || openedSync.current) return;
    openedSync.current = true;
    setSyncing(true);
    void send({ type: "sync" })
      .catch(() => undefined)
      .finally(() => setSyncing(false));
  }, [state.status]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return entries;
    return entries.filter((entry) =>
      [entry.label, entry.issuer, entry.accountName].some((field) =>
        field.toLowerCase().includes(term),
      ),
    );
  }, [entries, search]);

  if (state.status === "loading") return <LoadingState />;

  if (state.status === "setup") {
    return (
      <PopupShell>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16">
          <KeyRound className="size-6 text-muted-foreground/40" />
          <Button size="sm" onClick={() => void openOptionsPage()}>
            Set up
          </Button>
        </div>
      </PopupShell>
    );
  }

  if (state.status === "locked") {
    return (
      <PopupShell>
        <UnlockScreen onUnlock={unlock} compact />
      </PopupShell>
    );
  }

  const runSync = async () => {
    setSyncing(true);
    try {
      await send({ type: "sync" });
      await refresh();
    } catch {
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  return (
    <PopupShell>
      <header className="h-11 shrink-0 border-b border-border/50 flex items-center gap-1.5 px-3">
        <KeyRound className="size-4 text-muted-foreground" />
        <span className="text-xs font-semibold text-accent-strong flex-1">
          Authenticator
        </span>

        <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums flex items-center gap-1">
          {preferences.lastSyncError && (
            <TriangleAlert
              className="size-3 text-destructive"
              aria-label={preferences.lastSyncError}
            />
          )}
          {formatRelative(preferences.lastSyncAt)}
        </span>

        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Sync now"
          disabled={syncing}
          onClick={() => void runSync()}
        >
          {syncing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Lock"
          onClick={() => void lock()}
        >
          <Lock className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label="Settings"
          onClick={() => void openOptionsPage()}
        >
          <Settings className="size-3.5" />
        </Button>
      </header>

      {entries.length > 5 && (
        <div className="px-3 py-2 border-b border-border/50 shrink-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search"
              aria-label="Search accounts"
              className="pl-8 h-7 text-xs"
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="h-full flex items-center justify-center py-12">
            <span className="text-xs text-muted-foreground/50 tabular-nums">
              {entries.length === 0 ? "0" : "—"}
            </span>
          </div>
        ) : (
          filtered.map((entry) => (
            <AccountRow
              key={entry.id}
              entry={entry}
              code={codes[entry.id]}
              onEdit={() => setEditing(entry)}
              onDelete={() =>
                void send({ type: "deleteAccount", id: entry.id })
              }
            />
          ))
        )}
      </div>

      <footer className="h-10 shrink-0 border-t border-border/50 flex items-center justify-between px-3">
        <span className="text-[10px] font-mono text-muted-foreground/60 tabular-nums">
          {entries.length}
        </span>
        <Button
          size="sm"
          className="h-7 text-xs"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-3" /> Add
        </Button>
      </footer>

      <AddAccountDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        onAdd={async (inputs) => {
          await send({ type: "addAccounts", inputs });
          await refresh();
        }}
      />

      <EditAccountDialog
        key={editing?.id ?? "edit"}
        entry={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSave={async (edit) => {
          if (!editing) return;
          await send({ type: "editAccount", id: editing.id, edit });
          await refresh();
        }}
      />
    </PopupShell>
  );
}
