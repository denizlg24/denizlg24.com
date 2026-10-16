import { DashboardNative } from "@modules/dashboard-native";
import { createAdminApi } from "@repo/native-auth";
import { MOBILE_INSTALLATION_HEADER } from "@repo/schemas";
import { auth } from "./auth";
import { SITE } from "./config";

export const api = createAdminApi({
  site: SITE,
  auth,
  fetch: (input, init) => fetch(input, init),
  headers: (): Record<string, string> =>
    DashboardNative
      ? { [MOBILE_INSTALLATION_HEADER]: DashboardNative.installationId() }
      : {},
});
