import { createAdminApi } from "@repo/native-auth";
import { auth } from "./auth";
import { SITE } from "./config";

export const api = createAdminApi({
  site: SITE,
  auth,
  fetch: (input, init) => fetch(input, init),
});
