import { requireOptionalNativeModule } from "expo";

export type HealthActivityDay = {
  date: string;
  steps?: number;
  activeEnergyKcal?: number;
};

export type HealthBodyDay = {
  date: string;
  weightKg: number;
  bodyFatPct?: number;
};

export type HealthNutritionDay = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

type MacrosHealthNative = {
  isAvailable(): boolean;
  requestAuthorization(): Promise<boolean>;
  readDailyActivity(
    start: string,
    end: string,
    timeZone: string,
  ): Promise<HealthActivityDay[]>;
  readBodySamples(
    start: string,
    end: string,
    timeZone: string,
  ): Promise<HealthBodyDay[]>;
  writeDailyNutrition(
    days: HealthNutritionDay[],
    timeZone: string,
  ): Promise<number>;
};

/** Null in Expo Go and anywhere the native module was not built in. */
export const MacrosHealth =
  requireOptionalNativeModule<MacrosHealthNative>("MacrosHealth");
