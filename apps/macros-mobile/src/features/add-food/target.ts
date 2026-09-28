import { useCalorieSummary } from "@/api/dashboard";
import { useProfile } from "@/api/profile";
import { deviceTimeZone, useToday } from "@/lib/day";
import type { EnergyUnit } from "@/lib/format";
import {
  type LogTime,
  type LogTimeParams,
  logTimeParams,
  readLogTime,
} from "@/lib/log-time";
import type { MacroTargets } from "./nutrition";

type RouteParam = string | string[] | undefined;

export function readParam(value: RouteParam): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function parseNumberParam(value: RouteParam): number | undefined {
  const raw = readParam(value);
  if (raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Where a log goes: the `date` / `time` the caller routed with (the Log tab
 * adds to a day, or to an hour of it), otherwise today at the moment of
 * logging.
 */
export function routedLogTime(
  params: { date?: RouteParam; time?: RouteParam },
  today: string,
): LogTime {
  return readLogTime(
    { date: readParam(params.date), time: readParam(params.time) },
    today,
  );
}

/** The routed time, validated, for the next screen in the flow. */
export function forwardedTimeParams(
  params: { date?: RouteParam; time?: RouteParam },
  today: string,
): LogTimeParams {
  return logTimeParams(routedLogTime(params, today), today);
}

export interface ZoneContext {
  timeZone: string;
  today: string;
  energyUnit: EnergyUnit;
}

/** The profile's zone and energy unit, with "today" rolling over at midnight. */
export function useZone(): ZoneContext {
  const profile = useProfile();
  const timeZone = profile.data?.timezone ?? deviceTimeZone();
  const today = useToday(timeZone);
  return { timeZone, today, energyUnit: profile.data?.energyUnit ?? "kcal" };
}

/** Today's energy and macro targets, which amounts are measured against. */
export function useTargets(today: string): MacroTargets | null {
  const summary = useCalorieSummary(today).data;
  return summary
    ? {
        calories: summary.target,
        protein: summary.proteinTarget,
        carbs: summary.carbsTarget,
        fat: summary.fatTarget,
      }
    : null;
}
