import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { Separator } from "@repo/ui/separator";
import { Skeleton } from "@repo/ui/skeleton";
import {
  Download,
  KeyRound,
  Loader2,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { SetupScreen } from "../../components/setup-screen";
import { UnlockScreen } from "../../components/unlock-screen";
import { useVaultState } from "../../hooks/use-vault-state";
import {
  EXTENSION_VERSION,
  hasHostPermission,
  requestHostPermission,
} from "../../lib/browser";
import { formatRelative } from "../../lib/format";
import { send } from "../../lib/messages";
import { readVaultRecord } from "../../lib/storage";
import type { Preferences, TrashedEntry, VaultRecord } from "../../lib/types";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ConnectionSection({ preferences }: { preferences: Preferences }) {
  const [apiBaseUrl, setApiBaseUrl] = useState(preferences.apiBaseUrl);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(
    () => setApiBaseUrl(preferences.apiBaseUrl),
    [preferences.apiBaseUrl],
  );

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const url = apiBaseUrl.trim().replace(/\/$/, "");
      new URL(url);

      if (
        !(await hasHostPermission(url)) &&
        !(await requestHostPermission(url))
      ) {
        setMessage("Permission declined");
        return;
      }

      await send({ type: "updateCredentials", apiBaseUrl: url, apiKey });
      await send({ type: "sync" });
      setApiKey("");
      setMessage("Saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Connection">
      <div className="space-y-1.5">
        <Label htmlFor="base-url" className="text-xs">
          API base URL
        </Label>
        <Input
          id="base-url"
          value={apiBaseUrl}
          onChange={(event) => setApiBaseUrl(event.target.value)}
          className="h-8 text-sm font-mono"
          spellCheck={false}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="new-api-key" className="text-xs">
          API key
        </Label>
        <Input
          id="new-api-key"
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          placeholder="••••••••"
          className="h-8 text-sm font-mono"
          autoComplete="off"
        />
      </div>
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={busy || apiKey.trim().length === 0}
          onClick={() => void save()}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Save
        </Button>
        {message && (
          <span className="text-xs text-muted-foreground">{message}</span>
        )}
      </div>
    </Section>
  );
}

function SecuritySection({
  preferences,
  onLock,
}: {
  preferences: Preferences;
  onLock: () => Promise<void>;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const change = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await send({ type: "changePassphrase", passphrase });
      setPassphrase("");
      setConfirmation("");
      setMessage("Passphrase changed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="Security">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-passphrase" className="text-xs">
            New passphrase
          </Label>
          <Input
            id="new-passphrase"
            type="password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            className="h-8 text-sm"
            autoComplete="new-password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="repeat-passphrase" className="text-xs">
            Repeat
          </Label>
          <Input
            id="repeat-passphrase"
            type="password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            className="h-8 text-sm"
            autoComplete="new-password"
          />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={
            busy || passphrase.length < 8 || passphrase !== confirmation
          }
          onClick={() => void change()}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Change
        </Button>
        <Button variant="outline" size="sm" onClick={() => void onLock()}>
          Lock now
        </Button>
        {message && (
          <span className="text-xs text-muted-foreground">{message}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 pt-1">
        <NumberPreference
          id="auto-lock"
          label="Auto-lock (minutes)"
          value={preferences.autoLockMinutes}
          min={1}
          max={480}
          onCommit={(autoLockMinutes) =>
            send({ type: "updatePreferences", patch: { autoLockMinutes } })
          }
        />
        <NumberPreference
          id="sync-interval"
          label="Sync interval (minutes)"
          value={preferences.syncIntervalMinutes}
          min={1}
          max={1440}
          onCommit={(syncIntervalMinutes) =>
            send({ type: "updatePreferences", patch: { syncIntervalMinutes } })
          }
        />
      </div>
    </Section>
  );
}

function NumberPreference({
  id,
  label,
  value,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => Promise<unknown>;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft);
          if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
            setDraft(String(value));
            return;
          }
          void onCommit(parsed);
        }}
        className="h-8 text-sm tabular-nums"
      />
    </div>
  );
}

function SyncSection({ preferences }: { preferences: Preferences }) {
  const [busy, setBusy] = useState(false);

  return (
    <Section title="Sync">
      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void send({ type: "sync" })
              .catch(() => undefined)
              .finally(() => setBusy(false));
          }}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          Sync now
        </Button>
        <span className="text-xs text-muted-foreground tabular-nums">
          {formatRelative(preferences.lastSyncAt)}
        </span>
        {preferences.lastSyncError && (
          <span className="text-xs text-destructive truncate">
            {preferences.lastSyncError}
          </span>
        )}
      </div>
    </Section>
  );
}

function TrashSection({
  trash,
  preferences,
}: {
  trash: TrashedEntry[];
  preferences: Preferences;
}) {
  return (
    <Section title={`Trash (${trash.length})`}>
      <NumberPreference
        id="trash-retention"
        label="Retention (days)"
        value={preferences.trashRetentionDays}
        min={1}
        max={365}
        onCommit={(trashRetentionDays) =>
          send({ type: "updatePreferences", patch: { trashRetentionDays } })
        }
      />

      {trash.length > 0 && (
        <div className="border border-border/50 rounded-md divide-y divide-border/50">
          {trash.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-accent-strong truncate">
                  {entry.label}
                </p>
                <p className="text-[11px] text-muted-foreground/60 tabular-nums">
                  {entry.reason === "remote" ? "removed on server" : "deleted"}{" "}
                  · {formatRelative(entry.deletedAt)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  void send({ type: "restoreAccount", id: entry.id })
                }
              >
                <RotateCcw className="size-3" /> Restore
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 text-destructive"
                aria-label={`Purge ${entry.label}`}
                onClick={() =>
                  void send({ type: "purgeTrashEntry", id: entry.id })
                }
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {trash.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void send({ type: "emptyTrash" })}
        >
          Empty trash
        </Button>
      )}
    </Section>
  );
}

function BackupSection() {
  const fileInput = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState<string | null>(null);

  const exportVault = async () => {
    const record = await readVaultRecord();
    if (!record) return;

    // The file is the encrypted blob exactly as stored: useless without the
    // passphrase, so it can live anywhere.
    const blob = new Blob([JSON.stringify(record, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `authenticator-vault-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const importVault = async (file: File) => {
    setMessage(null);
    try {
      const parsed = JSON.parse(await file.text()) as VaultRecord;
      if (parsed.version !== 1 || !parsed.payload?.ciphertext) {
        throw new Error("Not a vault backup");
      }
      await send({ type: "replaceVault", record: parsed });
      setMessage("Imported — unlock with that backup's passphrase");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Import failed");
    }
  };

  return (
    <Section title="Backup">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={() => void exportVault()}>
          <Download className="size-3.5" /> Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInput.current?.click()}
        >
          <Upload className="size-3.5" /> Import
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void importVault(file);
            event.target.value = "";
          }}
        />
        {message && (
          <span className="text-xs text-muted-foreground">{message}</span>
        )}
      </div>
    </Section>
  );
}

function DangerSection() {
  const [armed, setArmed] = useState(false);

  return (
    <Section title="Reset">
      {armed ? (
        <div className="flex items-center gap-3">
          <Button
            variant="destructive"
            size="sm"
            onClick={() => void send({ type: "reset" })}
          >
            Erase vault and settings
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setArmed(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setArmed(true)}>
          Erase local data
        </Button>
      )}
    </Section>
  );
}

export function Options() {
  const { state, preferences, refresh, unlock, lock } = useVaultState();

  if (state.status === "loading") {
    return (
      <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (state.status === "setup") {
    return <SetupScreen onDone={() => void refresh()} />;
  }

  if (state.status === "locked") {
    return (
      <div className="max-w-2xl mx-auto">
        <UnlockScreen onUnlock={unlock} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">
      <header className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold text-accent-strong flex-1">
          Authenticator
        </h1>
        <span className="text-[11px] font-mono text-muted-foreground/60 tabular-nums">
          {state.payload.entries.length} · v{EXTENSION_VERSION}
        </span>
      </header>

      <ConnectionSection preferences={preferences} />
      <Separator />
      <SecuritySection preferences={preferences} onLock={lock} />
      <Separator />
      <SyncSection preferences={preferences} />
      <Separator />
      <TrashSection trash={state.payload.trash} preferences={preferences} />
      <Separator />
      <BackupSection />
      <Separator />
      <DangerSection />
    </div>
  );
}
