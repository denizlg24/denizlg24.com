import {
  type MacrosVisionLabelFormat,
  type MacrosVisionLabelResponse,
  macrosVisionLabelResponseSchema,
} from "@repo/schemas/macros";
import { File, UploadType } from "expo-file-system";
import {
  ApiError,
  buildUrl,
  NetworkError,
  reportUnauthorized,
} from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export interface LabelPhoto {
  /** A local `file://` URI, already downscaled to what the parser needs. */
  uri: string;
  labelFormat: MacrosVisionLabelFormat;
}

function errorFromBody(body: string, status: number): ApiError {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof parsed.error === "string"
    ) {
      return new ApiError(status, parsed.error, []);
    }
  } catch {}
  return new ApiError(status, `Request failed (${status})`, []);
}

/**
 * `POST /api/vision/label` takes multipart form data: the photo as `image`
 * and an optional `labelFormat` of `eu` or `us`. The photo is streamed from
 * disk by the native uploader rather than read into JS.
 */
export async function parseNutritionLabel(
  { uri, labelFormat }: LabelPhoto,
  signal?: AbortSignal,
): Promise<MacrosVisionLabelResponse> {
  const headers: Record<string, string> = { Accept: "application/json" };
  const cookie = await authClient.getCookie();
  if (cookie) headers.Cookie = cookie;

  let result: Awaited<ReturnType<File["upload"]>>;
  try {
    result = await new File(uri).upload(buildUrl("/api/vision/label"), {
      httpMethod: "POST",
      uploadType: UploadType.MULTIPART,
      fieldName: "image",
      mimeType: "image/jpeg",
      parameters: { labelFormat },
      headers,
      sessionType: "foreground",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new NetworkError(error);
  }

  if (result.status === 401) reportUnauthorized();
  if (result.status < 200 || result.status >= 300) {
    throw errorFromBody(result.body, result.status);
  }
  return macrosVisionLabelResponseSchema.parse(JSON.parse(result.body));
}

/**
 * The vision service is a separate container that can be down while Macros is
 * up; the route answers 5xx then, and the caller falls back to manual entry.
 */
export function isVisionUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 500;
}
