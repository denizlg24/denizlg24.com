import {
  macrosVisionClassifyResponseSchema,
  macrosVisionLabelResponseSchema,
} from "@repo/schemas/macros";

const DEFAULT_TIMEOUT_MS = 15_000;

export class VisionServiceError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "VisionServiceError";
  }
}

async function requestVision(path: "/v1/label" | "/v1/classify", image: Blob) {
  const baseUrl = process.env.MACROS_VISION_URL?.replace(/\/$/, "");
  const token = process.env.MACROS_VISION_API_TOKEN;
  if (!baseUrl || !token) {
    throw new VisionServiceError("Vision service is not configured", null);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.MACROS_VISION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS),
    );
    try {
      const form = new FormData();
      form.append("image", image, "label.jpg");
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = new VisionServiceError(
          `Vision service returned ${response.status}`,
          response.status,
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

export async function parseNutritionLabel(image: Blob) {
  return macrosVisionLabelResponseSchema.parse(
    await requestVision("/v1/label", image),
  );
}

export async function classifyFoodPhoto(image: Blob) {
  return macrosVisionClassifyResponseSchema.parse(
    await requestVision("/v1/classify", image),
  );
}
