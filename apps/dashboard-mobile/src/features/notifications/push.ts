import { DashboardNative } from "@modules/dashboard-native";
import type {
  DashboardNotificationPrefs,
  MobileDeviceInput,
} from "@repo/schemas";
import * as Notifications from "expo-notifications";
import { api } from "@/lib/api";
import { APS_ENVIRONMENT } from "@/lib/config";

/**
 * Tells the server where to reach this phone and which kinds it wants. Sent
 * on every launch, because APNs can rotate the token, and again whenever a
 * toggle changes, because the server filters remote pushes itself.
 */
export async function registerForPush(prefs: DashboardNotificationPrefs) {
  if (!DashboardNative) return;
  const permission = await Notifications.getPermissionsAsync();
  const granted =
    permission.granted ||
    (permission.canAskAgain &&
      (
        await Notifications.requestPermissionsAsync({
          ios: { allowAlert: true, allowSound: true, allowBadge: false },
        })
      ).granted);
  if (!granted) return;
  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== "string") return;
  const body: MobileDeviceInput = {
    app: "dashboard",
    environment: APS_ENVIRONMENT,
    pushToken: token.data,
    notifications: prefs,
  };
  await api.request(`mobile/devices/${DashboardNative.installationId()}`, {
    method: "PUT",
    body,
  });
}

/** Before signing out, while the session can still call the API. */
export async function forgetPush() {
  if (!DashboardNative) return;
  await api
    .request(`mobile/devices/${DashboardNative.installationId()}`, {
      method: "DELETE",
    })
    .catch(() => undefined);
}
