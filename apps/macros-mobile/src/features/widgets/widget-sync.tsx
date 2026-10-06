import { MacrosWidgets } from "@modules/macros-widgets";
import { useEffect, useRef } from "react";
import { useDashboard } from "@/api/dashboard";
import { useProfile } from "@/api/profile";
import { useWeightOverview } from "@/api/weight";
import { useToday } from "@/lib/day";
import { buildWidgetSnapshot, snapshotKey } from "./snapshot";

const widgets = MacrosWidgets?.isAvailable() ? MacrosWidgets : null;

function SnapshotWriter() {
  const profile = useProfile().data;
  const day = useToday(profile?.timezone);
  const dashboard = useDashboard(day).data;
  const weightOverview = useWeightOverview().data;
  const written = useRef<string | null>(null);

  useEffect(() => {
    if (!profile || !dashboard) return;
    const snapshot = buildWidgetSnapshot({
      dashboard,
      weightOverview,
      mode: profile.caloriePreference,
      energyUnit: profile.energyUnit,
      weightUnit: profile.weightUnit,
    });
    const key = snapshotKey(snapshot);
    if (key === written.current) return;
    written.current = key;
    widgets?.setSnapshot(JSON.stringify(snapshot));
  }, [profile, dashboard, weightOverview]);

  return null;
}

/**
 * Keeps the Home Screen widgets' snapshot current. The dashboard includes
 * pending logs, so a widget moves the moment something is logged, offline
 * included.
 */
export function WidgetSync() {
  if (!widgets) return null;
  return <SnapshotWriter />;
}

/** Signing out must not leave one person's day on the Home Screen. */
export function clearWidgets() {
  widgets?.clear();
}
