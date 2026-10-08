import { adminUrl, NotSignedInError } from "@repo/native-auth";
import { fetch as streamingFetch } from "expo/fetch";
import { File, UploadType } from "expo-file-system";
import { auth } from "./auth";
import { SITE } from "./config";

/**
 * Every call goes through `expo/fetch`: it streams a response body (the
 * agent turn) and hands back raw bytes (speech), which React Native's fetch
 * does neither of.
 */

export class VoiceApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "VoiceApiError";
  }
}

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

/** Sends with the session; one refresh and retry on a 401. */
export async function send(
  path: string,
  init: { method?: string; body?: unknown; signal?: AbortSignal } = {},
) {
  const attempt = (token: string) =>
    streamingFetch(adminUrl(SITE, path), {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
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
  if (!response.ok) {
    throw new VoiceApiError(response.status, await errorMessage(response));
  }
  return response;
}

export async function getJson<T>(
  path: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await send(path, { signal });
  return JSON.parse(await response.text()) as T;
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await send(path, { method: "POST", body });
  return JSON.parse(await response.text()) as T;
}

/** A recorded file, as the multipart `file` field the route reads. */
export async function uploadAudio(path: string, uri: string): Promise<unknown> {
  const upload = (token: string) =>
    new File(uri).upload(adminUrl(SITE, path), {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "file",
      mimeType: "audio/mp4",
      headers: { authorization: `Bearer ${token}` },
      sessionType: "foreground",
    });
  const token = await auth.getAccessToken();
  let result = await upload(token);
  if (result.status === 401) {
    result = await upload(await auth.getAccessToken({ rejected: token }));
  }
  if (result.status < 200 || result.status >= 300) {
    let message = `Upload failed (${result.status})`;
    try {
      const body: unknown = JSON.parse(result.body);
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        typeof body.error === "string"
      ) {
        message = body.error;
      }
    } catch {}
    throw new VoiceApiError(result.status, message);
  }
  return JSON.parse(result.body);
}
