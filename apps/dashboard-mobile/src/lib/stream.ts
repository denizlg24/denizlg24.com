import { DashboardNative } from "@modules/dashboard-native";
import { adminUrl, NotSignedInError } from "@repo/native-auth";
import { MOBILE_INSTALLATION_HEADER } from "@repo/schemas";
import { fetch as streamingFetch } from "expo/fetch";
import { auth } from "./auth";
import { SITE } from "./config";

async function errorMessage(response: {
  status: number;
  text(): Promise<string>;
}) {
  try {
    const body: unknown = JSON.parse(await response.text());
    if (
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {}
  return `Request failed (${response.status})`;
}

/**
 * A JSON POST whose response body is read as it arrives, through
 * `expo/fetch`: React Native's own fetch buffers the whole body. One refresh
 * and retry on a 401, as the JSON client does.
 */
export async function postStream(
  path: string,
  body: unknown,
  signal?: AbortSignal,
) {
  const attempt = (token: string) =>
    streamingFetch(adminUrl(SITE, path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        ...(DashboardNative
          ? { [MOBILE_INSTALLATION_HEADER]: DashboardNative.installationId() }
          : {}),
      },
      body: JSON.stringify(body),
      signal,
    });
  const token = await auth.getAccessToken();
  let response = await attempt(token);
  if (response.status === 401) {
    response = await attempt(await auth.getAccessToken({ rejected: token }));
    if (response.status === 401) {
      await auth.expire();
      throw new NotSignedInError();
    }
  }
  if (!response.ok) throw new Error(await errorMessage(response));
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The reply was empty");
  return reader;
}
