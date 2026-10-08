import { HoursNative } from "@modules/hours-native";
import { createAdminApi } from "@repo/native-auth";
import { MOBILE_INSTALLATION_HEADER } from "@repo/schemas";
import { auth } from "./auth";
import { SITE } from "./config";

export const api = createAdminApi({
  site: SITE,
  auth,
  fetch: (input, init) => fetch(input, init),
  // The server skips this phone when it pushes a change the phone made.
  headers: (): Record<string, string> =>
    HoursNative
      ? { [MOBILE_INSTALLATION_HEADER]: HoursNative.installationId() }
      : {},
});
