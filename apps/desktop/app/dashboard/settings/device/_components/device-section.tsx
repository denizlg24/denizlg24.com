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
import { Switch } from "@repo/ui/switch";
import { Check, FolderOpen, Loader2, RefreshCw } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { showUpdateToast } from "@/components/window/update-notifier";
import { useUserSettings } from "@/context/user-context";
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
      <div className="flex sm:justify-end">
        <Switch
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  if (meta.type === "select" && meta.options) {
    return (
      <Select value={String(value)} onValueChange={(next) => onChange(next)}>
        <SelectTrigger className="h-8 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-72">
          {meta.options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              className="text-xs"
            >
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
      <div className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={local}
          placeholder="Select a directory…"
          className="h-8 min-w-0 flex-1 text-xs"
          onChange={(event) => setLocal(event.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
        />
        {isTauri() && (
          <Button
            variant="outline"
            size="icon"
            className="size-8 shrink-0"
            aria-label={`Browse for ${meta.label.toLowerCase()}`}
            onClick={() => void pick()}
          >
            <FolderOpen className="size-3.5" />
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
      placeholder={`Enter ${meta.label.toLowerCase()}…`}
      className="h-8 w-full text-xs"
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
      <SettingsRow
        label="App version"
        hint="Updates install in place, then restart the app."
      >
        <div className="flex items-center justify-end gap-2">
          {version && (
            <span className="text-xs tabular-nums text-muted-foreground">
              v{version}
            </span>
          )}
          {state === "latest" && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Check className="size-3" />
              Up to date
            </span>
          )}
          {state === "error" && (
            <span className="text-xs text-destructive">Check failed</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 text-xs"
            disabled={state === "checking"}
            onClick={() => void check()}
          >
            {state === "checking" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Check
          </Button>
        </div>
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
        <div className="space-y-6">
          {fields.map(([key, meta]) => (
            <SettingsRow key={key} label={meta.label} hint={meta.description}>
              <FieldControl
                meta={meta}
                value={settings[key]}
                onChange={(value) => setSettings({ [key]: value })}
              />
            </SettingsRow>
          ))}
        </div>
      </SettingsGroup>
      <UpdateGroup />
    </>
  );
}
