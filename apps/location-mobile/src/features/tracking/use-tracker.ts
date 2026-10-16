import { LocationNative, type TrackerStatus } from "@modules/location-native";
import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

const POLL_MS = 2_000;

/**
 * The native tracker's state, polled while the app is in front. Coming back
 * to the foreground also uploads anything queued, so the server side of the
 * screen is current.
 */
export function useTracker() {
  const [status, setStatus] = useState<TrackerStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!LocationNative) return;
    setStatus(await LocationNative.status());
  }, []);

  useEffect(() => {
    void LocationNative?.flush();
    void refresh();
    let timer = setInterval(() => void refresh(), POLL_MS);
    const subscription = AppState.addEventListener("change", (state) => {
      clearInterval(timer);
      if (state !== "active") return;
      void LocationNative?.flush();
      void refresh();
      timer = setInterval(() => void refresh(), POLL_MS);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  return { status, refresh, available: LocationNative !== null };
}
