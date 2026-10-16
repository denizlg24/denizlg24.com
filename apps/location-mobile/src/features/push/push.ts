import { LocationNative } from "@modules/location-native";
import type { MobileDeviceInput } from "@repo/schemas";
import * as Notifications from "expo-notifications";
import { api } from "@/lib/api";
import { APS_ENVIRONMENT } from "@/lib/config";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Asks for notifications and tells the server where to reach this phone.
 * Sent on every launch: APNs can rotate the token, and the server keeps
 * only the latest.
 */
export async function registerForPush() {
  if (!LocationNative) return;
  const permission = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  if (!permission.granted) return;
  const token = await Notifications.getDevicePushTokenAsync();
  if (typeof token.data !== "string") return;
  const body: MobileDeviceInput = {
    app: "location",
    environment: APS_ENVIRONMENT,
    pushToken: token.data,
  };
  await api.request(`mobile/devices/${LocationNative.installationId()}`, {
    method: "PUT",
    body,
  });
}

/** Before signing out, while the session can still call the API. */
export async function forgetPush() {
  if (!LocationNative) return;
  await api
    .request(`mobile/devices/${LocationNative.installationId()}`, {
      method: "DELETE",
    })
    .catch(() => undefined);
}
