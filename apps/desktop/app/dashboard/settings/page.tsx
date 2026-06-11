"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Settings as SettingsIcon } from "lucide-react";
import {
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { ICalendarSettings, ICountryOption } from "@/lib/data-types";
import {
  ensureTrailingSeparator,
  type SettingsFieldMeta,
  settingsFieldMeta,
  type UserSettings,
} from "@/lib/user-settings";

function SettingsFieldRow({
  fieldKey,
  meta,
  value,
  onChange,
}: {
  fieldKey: keyof UserSettings;
  meta: SettingsFieldMeta;
  value: string | boolean;
  onChange: (value: string | boolean) => void;
}) {
  const [localValue, setLocalValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  const commitText = () => {
    if (localValue !== String(value)) {
      onChange(localValue);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      inputRef.current?.blur();
    }
  };

  if (meta.type === "boolean") {
    return (
      <div
        key={fieldKey}
        className="flex items-center justify-between gap-4 py-4"
      >
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-medium">{meta.label}</Label>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <Switch
          checked={value as boolean}
          onCheckedChange={(checked) => onChange(checked)}
        />
      </div>
    );
  }

  if (meta.type === "select" && meta.options) {
    return (
      <div
        key={fieldKey}
        className="flex items-center justify-between gap-4 py-4"
      >
        <div className="flex flex-col gap-1 shrink-0">
          <Label className="text-sm font-medium">{meta.label}</Label>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <Select value={value as string} onValueChange={(val) => onChange(val)}>
          <SelectTrigger className="w-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {meta.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  if (meta.type === "path") {
    const pickDirectory = async () => {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: localValue || undefined,
      });
      if (selected) {
        const withSep = ensureTrailingSeparator(selected);
        setLocalValue(withSep);
        onChange(withSep);
      }
    };

    return (
      <div
        key={fieldKey}
        className="flex items-center justify-between gap-4 py-4"
      >
        <div className="flex flex-col gap-1 shrink-0">
          <Label className="text-sm font-medium">{meta.label}</Label>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
        </div>
        <div className="flex items-center gap-1.5 max-w-xs w-full">
          <Input
            ref={inputRef}
            type="text"
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={commitText}
            onKeyDown={handleKeyDown}
            placeholder={`Select a directory...`}
          />
          <Button
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={pickDirectory}
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      key={fieldKey}
      className="flex items-center justify-between gap-4 py-4"
    >
      <div className="flex flex-col gap-1 shrink-0">
        <Label className="text-sm font-medium">{meta.label}</Label>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>
      <Input
        ref={inputRef}
        type={meta.sensitive ? "password" : "text"}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={commitText}
        onKeyDown={handleKeyDown}
        className="max-w-xs"
        placeholder={`Enter ${meta.label.toLowerCase()}...`}
      />
    </div>
  );
}

function regionFromLocale(value: string) {
  try {
    const locale = new Intl.Locale(value);
    return locale.region?.toUpperCase() ?? null;
  } catch {
    const match = value.match(/[-_]([A-Za-z]{2})\b/);
    return match?.[1]?.toUpperCase() ?? null;
  }
}

function CalendarSyncSettings({ api }: { api: denizApi | null }) {
  const [countries, setCountries] = useState<ICountryOption[]>([]);
  const [remoteSettings, setRemoteSettings] =
    useState<ICalendarSettings | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string>("none");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!api) return;
    const client = api;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const [settingsResult, countriesResult] = await Promise.all([
        client.GET<{ settings: ICalendarSettings }>({
          endpoint: "calendar/settings",
        }),
        client.GET<{ countries: ICountryOption[] }>({
          endpoint: "calendar/countries",
        }),
      ]);

      if (cancelled) return;

      if ("code" in settingsResult) {
        toast.error(settingsResult.message);
      } else {
        setRemoteSettings(settingsResult.settings);
        setSelectedCountry(
          settingsResult.settings.holidayCountryCode ?? "none",
        );
      }

      if ("code" in countriesResult) {
        toast.error(countriesResult.message);
      } else {
        setCountries(countriesResult.countries);
      }

      setLoading(false);
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [api]);

  useEffect(() => {
    if (remoteSettings?.holidayCountryCode || selectedCountry !== "none")
      return;
    if (countries.length === 0) return;

    async function prefillFromLocale() {
      try {
        const { locale } = await import("@tauri-apps/plugin-os");
        const osLocale = await locale();
        const region = osLocale ? regionFromLocale(osLocale) : null;
        if (
          region &&
          countries.some((country) => country.countryCode === region)
        ) {
          setSelectedCountry(region);
        }
      } catch {}
    }

    void prefillFromLocale();
  }, [countries, remoteSettings?.holidayCountryCode, selectedCountry]);

  const commit = async (next: string) => {
    if (!api) return;
    const previous = selectedCountry;
    setSelectedCountry(next);
    setSaving(true);
    const result = await api.PATCH<{ settings: ICalendarSettings }>({
      endpoint: "calendar/settings",
      body: {
        holidayCountryCode: next === "none" ? null : next,
      },
    });
    setSaving(false);
    if ("code" in result) {
      toast.error(result.message);
      setSelectedCountry(previous);
      return;
    }
    setRemoteSettings(result.settings);
  };

  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <div className="flex flex-col gap-1 shrink-0">
        <Label className="text-sm font-medium">Calendar sync</Label>
        <p className="text-xs text-muted-foreground">
          Holiday country used by backend calendar generation.
        </p>
      </div>
      {loading ? (
        <Skeleton className="h-9 w-xs" />
      ) : (
        <div className="flex items-center gap-1.5">
          {saving && (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          )}
          <Select value={selectedCountry} onValueChange={commit}>
            <SelectTrigger className="w-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value="none">No holiday sync</SelectItem>
              {countries.map((country) => (
                <SelectItem
                  key={country.countryCode}
                  value={country.countryCode}
                >
                  {country.name} ({country.countryCode})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

function SettingsLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <SettingsIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Settings</span>
      </div>
      <div className="px-4 flex flex-col gap-0">
        {[1, 2].map((i) => (
          <div key={i} className="flex items-center justify-between gap-4 py-4">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-9 w-48" />
          </div>
        ))}
        <Separator />
        <div className="py-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-3 w-64" />
          <div className="flex gap-2 mt-2">
            <Skeleton className="h-6 flex-1 rounded" />
            <Skeleton className="h-6 flex-1 rounded" />
          </div>
          <Skeleton className="h-6 w-3/4 rounded" />
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { settings, setSettings, loading } = useUserSettings();
  const api = useMemo(() => {
    if (loading) return null;
    return new denizApi(settings.apiKey);
  }, [settings.apiKey, loading]);

  if (loading) {
    return <SettingsLoadingSkeleton />;
  }

  const visibleFields = (
    Object.entries(settingsFieldMeta) as [
      keyof UserSettings,
      SettingsFieldMeta,
    ][]
  ).filter(([, meta]) => !meta.hidden);

  return (
    <div className="flex flex-col gap-2 pb-4">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <SettingsIcon className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Settings</span>
      </div>

      <div className="px-4 flex flex-col gap-0">
        {visibleFields.map(([key, meta], i) => (
          <div key={key}>
            {i > 0 && <Separator />}
            <SettingsFieldRow
              fieldKey={key}
              meta={meta}
              value={settings[key]}
              onChange={(val) => setSettings({ [key]: val })}
            />
          </div>
        ))}

        <Separator />
        <CalendarSyncSettings api={api} />
      </div>
    </div>
  );
}
