import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useProfile, useUpdateTimezone } from "@/api/profile";
import { deviceTimeZone } from "@/lib/day";

/**
 * The server decides which day an entry belongs to from the profile's zone.
 * Travelling changes the phone's zone; this keeps the profile in step so
 * "today" on the server matches today on the phone.
 */
export function TimezoneSync() {
  const profile = useProfile();
  const { mutate, isPending } = useUpdateTimezone();
  const attempted = useRef<string | null>(null);
  const stored = profile.data?.timezone;

  useEffect(() => {
    function sync() {
      const current = deviceTimeZone();
      if (!stored || stored === current || isPending) return;
      if (attempted.current === current) return;
      attempted.current = current;
      mutate(current);
    }
    sync();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") sync();
    });
    return () => subscription.remove();
  }, [stored, isPending, mutate]);

  return null;
}
