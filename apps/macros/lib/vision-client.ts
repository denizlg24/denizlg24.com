import {
  type MacrosVisionClassifyResponse,
  type MacrosVisionLabelFormat,
  type MacrosVisionLabelResponse,
  macrosVisionClassifyResponseSchema,
  macrosVisionLabelResponseSchema,
} from "@repo/schemas/macros";

const DEFAULT_TIMEOUT_MS = 15_000;
const LABEL_TIMEOUT_MS = 20_000;
const DEFAULT_LABEL_SERVICE_URL = "https://denizlg24.com";

function getVisionTimeoutMs() {
  const configured = Number(process.env.MACROS_VISION_TIMEOUT_MS);
  if (!Number.isFinite(configured) || configured < 1_000) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(configured, 60_000);
}

export class VisionServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "VisionServiceError";
  }
}

/**
 * Our credential being refused is our misconfiguration, not the caller's
 * session: passed through, a 401 would sign the phone out.
 */
function upstreamStatus(status: number): number | null {
  return status === 401 || status === 403 ? null : status;
}

async function requestVision(path: "/v1/classify", image: Blob) {
  const baseUrl = process.env.MACROS_VISION_URL?.replace(/\/$/, "");
  const token = process.env.MACROS_VISION_API_TOKEN;
  if (!baseUrl || !token) {
    throw new VisionServiceError("Vision service is not configured", null);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), getVisionTimeoutMs());
    try {
      const form = new FormData();
      form.append("image", image, "photo.jpg");
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${token}`,
        },
        body: form,
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) {
        const error = new VisionServiceError(
          `Vision service returned ${response.status}`,
          upstreamStatus(response.status),
        );
        if (response.status < 500 || attempt === 1) throw error;
        lastError = error;
        continue;
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (
        error instanceof VisionServiceError &&
        error.status != null &&
        error.status < 500
      ) {
        throw error;
      }
      if (attempt === 1) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new VisionServiceError(
    lastError instanceof Error
      ? lastError.message
      : "Vision service unavailable",
    lastError instanceof VisionServiceError ? lastError.status : null,
  );
}

/**
 * Labels are read by a vision model behind denizlg24.com's LLM service, with a
 * secret scoped to that one route. One attempt: the model either answers well
 * inside the deadline or the user is better served retaking the photo.
 */
export async function parseNutritionLabel(
  image: Blob,
  labelFormat?: MacrosVisionLabelFormat,
): Promise<MacrosVisionLabelResponse> {
  const baseUrl = (
    process.env.MACROS_LABEL_SERVICE_URL || DEFAULT_LABEL_SERVICE_URL
  ).replace(/\/$/, "");
  const token = process.env.MACROS_LABEL_SERVICE_TOKEN;
  if (!token) {
    throw new VisionServiceError("Label reading is not configured", null);
  }

  const form = new FormData();
  form.append("image", image, "label.jpg");
  if (labelFormat) form.append("labelFormat", labelFormat);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/services/macros/nutrition-label`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      body: form,
      signal: AbortSignal.timeout(LABEL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (error) {
    throw new VisionServiceError(
      error instanceof Error ? error.message : "Label reading unavailable",
      null,
    );
  }
  if (!response.ok) {
    throw new VisionServiceError(
      `Label reading returned ${response.status}`,
      upstreamStatus(response.status),
    );
  }
  return macrosVisionLabelResponseSchema.parse(await response.json());
}

export async function classifyFoodPhoto(
  image: Blob,
): Promise<MacrosVisionClassifyResponse> {
  return macrosVisionClassifyResponseSchema.parse(
    await requestVision("/v1/classify", image),
  );
}
