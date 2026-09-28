import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  type MacrosStatisticsPeriod,
  macrosStatisticsPeriodSchema,
} from "@repo/schemas/macros";
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "macros.statistics-period";

/** The chosen period survives relaunches, like the web app's. */
export function useStatisticsPeriod(): [
  MacrosStatisticsPeriod,
  (period: MacrosStatisticsPeriod) => void,
] {
  const [period, setPeriod] = useState<MacrosStatisticsPeriod>("28d");

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        const parsed = macrosStatisticsPeriodSchema.safeParse(stored);
        if (!cancelled && parsed.success) setPeriod(parsed.data);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const update = useCallback((next: MacrosStatisticsPeriod) => {
    setPeriod(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  return [period, update];
}
