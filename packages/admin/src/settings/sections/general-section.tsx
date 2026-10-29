"use client";

import {
  type AppSettingsResponse,
  type CalendarSettingsResponse,
  type CountryOptionsResponse,
  calendarSettingsResponseSchema,
  countryOptionsResponseSchema,
  type ICalendarSettings,
  type ICountryOption,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../../provider";
import { SettingsGroup, SettingsRow } from "../settings-shell";

const TIMEZONE_DEFAULT = "__default__";
const COUNTRY_NONE = "none";

function regionFromLocale(value: string) {
  try {
    return new Intl.Locale(value).region?.toUpperCase() ?? null;
  } catch {
    return value.match(/[-_]([A-Za-z]{2})\b/)?.[1]?.toUpperCase() ?? null;
  }
}

function TimeZoneSetting() {
  const { client } = useAdmin();
  const [settings, setSettings] = useState<
    AppSettingsResponse["settings"] | null
  >(null);
  const [value, setValue] = useState(TIMEZONE_DEFAULT);
  const [saving, setSaving] = useState(false);

  const timeZones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const deviceTimeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await client.get<AppSettingsResponse>("settings");
        if (cancelled) return;
        setSettings(data.settings);
        setValue(data.settings.timeZone ?? TIMEZONE_DEFAULT);
      } catch {
        if (!cancelled) toast.error("Failed to load settings");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const commit = useCallback(
    async (next: string) => {
      const previous = value;
      setValue(next);
      setSaving(true);
      try {
        const data = await client.patch<AppSettingsResponse>("settings", {
          timeZone: next === TIMEZONE_DEFAULT ? null : next,
        });
        setSettings(data.settings);
      } catch {
        setValue(previous);
        toast.error("Failed to save");
      } finally {
        setSaving(false);
      }
    },
    [client, value],
  );

  const canUseDevice =
    value !== deviceTimeZone && timeZones.includes(deviceTimeZone);

  return (
    <SettingsRow label="Timezone">
      {!settings ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <div className="flex w-full items-center gap-1.5">
          {saving && (
            <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {canUseDevice && (
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => void commit(deviceTimeZone)}
            >
              Use device
            </Button>
          )}
          <Select value={value} onValueChange={(next) => void commit(next)}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value={TIMEZONE_DEFAULT}>
                Server default
                {settings.timeZone ? "" : ` (${settings.effectiveTimeZone})`}
              </SelectItem>
              {timeZones.map((zone) => (
                <SelectItem key={zone} value={zone}>
                  {zone.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </SettingsRow>
  );
}

function HolidayCountrySetting() {
  const { client } = useAdmin();
  const [countries, setCountries] = useState<ICountryOption[]>([]);
  const [stored, setStored] = useState<ICalendarSettings | null>(null);
  const [value, setValue] = useState(COUNTRY_NONE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [countriesFailed, setCountriesFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [settingsResult, countriesResult] = await Promise.allSettled([
        client.get<CalendarSettingsResponse>("calendar/settings"),
        client.get<CountryOptionsResponse>("calendar/countries"),
      ]);
      if (cancelled) return;

      if (settingsResult.status === "fulfilled") {
        const parsed = calendarSettingsResponseSchema.parse(
          settingsResult.value,
        );
        setStored(parsed.settings);
        setValue(parsed.settings.holidayCountryCode ?? COUNTRY_NONE);
      } else {
        toast.error("Failed to load calendar settings");
      }

      if (countriesResult.status === "fulfilled") {
        setCountries(
          countryOptionsResponseSchema.parse(countriesResult.value).countries,
        );
        setCountriesFailed(false);
      } else {
        // An empty picker is indistinguishable from "no countries available",
        // so the failure has to be visible rather than silent.
        setCountriesFailed(true);
        toast.error("Failed to load countries");
      }

      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  // Nothing stored yet: offer the host's region as a one-click save. Selecting
  // it in the picker instead would show a country the backend never stored.
  const suggestedRegion = useMemo(() => {
    if (stored?.holidayCountryCode || value !== COUNTRY_NONE) return null;
    if (countries.length === 0 || typeof navigator === "undefined") return null;
    const region = regionFromLocale(navigator.language);
    return region && countries.some((entry) => entry.countryCode === region)
      ? region
      : null;
  }, [countries, stored?.holidayCountryCode, value]);

  const commit = async (next: string) => {
    const previous = value;
    setValue(next);
    setSaving(true);
    try {
      const data = await client.patch<CalendarSettingsResponse>(
        "calendar/settings",
        { holidayCountryCode: next === COUNTRY_NONE ? null : next },
      );
      setStored(calendarSettingsResponseSchema.parse(data).settings);
    } catch {
      setValue(previous);
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SettingsRow label="Holidays">
      {loading ? (
        <Skeleton className="h-8 w-full" />
      ) : (
        <div className="flex w-full items-center gap-1.5">
          {saving && (
            <Spinner className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          {countriesFailed && (
            <span className="shrink-0 text-xs text-status-warning">
              Countries unavailable
            </span>
          )}
          {suggestedRegion && (
            <Button
              variant="outline"
              className="shrink-0"
              onClick={() => void commit(suggestedRegion)}
            >
              Use {suggestedRegion}
            </Button>
          )}
          <Select value={value} onValueChange={(next) => void commit(next)}>
            <SelectTrigger className="w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper" className="max-h-72">
              <SelectItem value={COUNTRY_NONE}>None</SelectItem>
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
    </SettingsRow>
  );
}

export function GeneralSection() {
  return (
    <>
      <SettingsGroup label="Time">
        <TimeZoneSetting />
      </SettingsGroup>
      <SettingsGroup label="Calendar">
        <HolidayCountrySetting />
      </SettingsGroup>
    </>
  );
}
