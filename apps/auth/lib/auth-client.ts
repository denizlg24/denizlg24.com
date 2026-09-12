import {
  createCloudAuthClient,
  createCloudOAuthClient,
} from "@repo/cloud-auth-client";
import { API_BASE_URL } from "@repo/cloud-ui/api-client";

export const authClient = createCloudOAuthClient({ baseURL: API_BASE_URL });

/**
 * TOTP enrollment must not resume an authorization: the session cookie it
 * sets would trigger the provider's redirect before the backup codes are on
 * screen. It runs on a client without the OAuth plugin, and the login page
 * resumes the authorization itself once the codes are acknowledged.
 */
export const enrollmentClient = createCloudAuthClient({
  baseURL: API_BASE_URL,
});
