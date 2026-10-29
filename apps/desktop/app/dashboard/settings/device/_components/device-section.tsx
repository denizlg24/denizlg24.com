"use client";

import {
  SettingsGroup,
  SettingsRow,
} from "@repo/admin/settings/settings-shell";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { Check, FolderOpen, LogOut, RefreshCw } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { showUpdateToast } from "@/components/window/update-notifier";
import { useUserSettings } from "@/context/user-context";
import { signOut } from "@/lib/auth/session";
import { isTauri } from "@/lib/platform";
import { pickDirectory } from "@/lib/platform-fs";
import { checkForUpdate } from "@/lib/updater";
import {
  ensureTrailingSeparator,
  type SettingsFieldMeta,
  settingsFieldMeta,
  type UserSettings,
} from "@/lib/user-settings";

function FieldControl({
  meta,
  value,
  onChange,
}: {
  meta: SettingsFieldMeta;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const [local, setLocal] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) setLocal(String(value));
  }, [value]);

  const commit = () => {
    if (local !== String(value)) onChange(local);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") inputRef.current?.blur();
  };

  if (meta.type === "boolean") {
    return (
      <Switch
        checked={value === true}
        aria-label={meta.label}
        onCheckedChange={(checked) => onChange(checked)}
      />
    );
  }

  if (meta.type === "select" && meta.options) {
    return (
      <Select value={String(value)} onValueChange={(next) => onChange(next)}>
        <SelectTrigger className="w-full" aria-label={meta.label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          {meta.options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (meta.type === "path") {
    const pick = async () => {
      const selected = await pickDirectory(local || undefined);
      if (!selected) return;
      const withSeparator = ensureTrailingSeparator(selected);
      setLocal(withSeparator);
      onChange(withSeparator);
    };

    return (
      <div className="flex w-full items-center gap-1.5">
        <Input
          ref={inputRef}
          value={local}
          aria-label={meta.label}
          className="min-w-0 flex-1"
          onChange={(event) => setLocal(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        {isTauri() && (
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            aria-label={`Browse for ${meta.label.toLowerCase()}`}
            onClick={() => void pick()}
          >
            <FolderOpen />
          </Button>
        )}
      </div>
    );
  }

  return (
    <Input
      ref={inputRef}
      type={meta.sensitive ? "password" : "text"}
      value={local}
      aria-label={meta.label}
      className="w-full"
      onChange={(event) => setLocal(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}

type CheckState = "idle" | "checking" | "latest" | "error";

function UpdateGroup() {
  const [version, setVersion] = useState<string | null>(null);
  const [state, setState] = useState<CheckState>("idle");

  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { getVersion } = await import("@tauri-apps/api/app");
        setVersion(await getVersion());
      } catch {}
    })();
  }, []);

  if (!isTauri()) return null;

  const check = async () => {
    setState("checking");
    try {
      const update = await checkForUpdate();
      if (update) {
        setState("idle");
        showUpdateToast(update);
      } else {
        setState("latest");
      }
    } catch {
      setState("error");
    }
  };

  return (
    <SettingsGroup label="Updates">
      <SettingsRow label="Version">
        <div className="flex items-center gap-2">
          {version && (
            <span className="text-xs tabular-nums text-muted-foreground">
              v{version}
            </span>
          )}
          {state === "latest" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3 text-status-good" />
              Latest
            </span>
          )}
          {state === "error" && (
            <span className="text-xs text-status-critical">Check failed</span>
          )}
          <Button
            variant="outline"
            className="shrink-0"
            disabled={state === "checking"}
            onClick={() => void check()}
          >
            {state === "checking" ? (
              <Spinner className="size-3.5" />
            ) : (
              <RefreshCw />
            )}
            Check
          </Button>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

function SessionGroup() {
  const [busy, setBusy] = useState(false);

  return (
    <SettingsGroup label="Session">
      <SettingsRow label="This device">
        <Button
          variant="outline"
          className="shrink-0"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void signOut().finally(() => setBusy(false));
          }}
        >
          {busy ? <Spinner className="size-3.5" /> : <LogOut />}
          Sign out
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

export function DeviceSection() {
  const { settings, setSettings } = useUserSettings();

  const fields = (
    Object.entries(settingsFieldMeta) as [
      keyof UserSettings,
      SettingsFieldMeta,
    ][]
  ).filter(([, meta]) => !meta.hidden);

  return (
    <>
      <SettingsGroup label="This device">
        {fields.map(([key, meta]) => (
          <SettingsRow key={key} label={meta.label}>
            <FieldControl
              meta={meta}
              value={settings[key]}
              onChange={(value) => setSettings({ [key]: value })}
            />
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SessionGroup />
      <UpdateGroup />
    </>
  );
}
