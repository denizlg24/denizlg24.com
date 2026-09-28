import { useProfile } from "@/api/profile";
import { deviceTimeZone, useToday } from "@/lib/day";
import type { EnergyUnit, WeightUnit } from "@/lib/format";

/** Display units and today in the profile's zone; the server always speaks kg and kcal. */
export function useUnits(): {
  weightUnit: WeightUnit;
  energyUnit: EnergyUnit;
  timezone: string;
  today: string;
} {
  const profile = useProfile().data;
  const timezone = profile?.timezone ?? deviceTimeZone();
  const today = useToday(timezone);
  return {
    weightUnit: profile?.weightUnit ?? "kg",
    energyUnit: profile?.energyUnit ?? "kcal",
    timezone,
    today,
  };
}
