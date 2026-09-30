import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import {
  type NotificationPermission,
  notificationPermission,
  requestNotificationPermission,
} from "./permissions";
import { registerForRemotePush } from "./push";

/** This phone's answer, kept current across trips to Settings. */
export function useNotificationPermission() {
  const [permission, setPermission] = useState<NotificationPermission | null>(
    null,
  );

  const refresh = useCallback(() => {
    notificationPermission()
      .then(setPermission)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    // Coming back from Settings is how a refusal gets undone.
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  /** Asks the first time; resolves whether notifications can be shown. */
  const ensure = useCallback(async () => {
    const next = await requestNotificationPermission().catch(
      (): NotificationPermission => "denied",
    );
    setPermission(next);
    if (next === "granted") registerForRemotePush().catch(() => undefined);
    return next === "granted";
  }, []);

  return { permission, ensure };
}
