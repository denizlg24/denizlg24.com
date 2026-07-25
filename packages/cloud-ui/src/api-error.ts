import { apiErrorResponseSchema } from "@repo/schemas/cloud";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Request failed";
}

/**
 * The Pi can reboot while the Vercel-hosted UI stays up, so a failure to reach
 * it at all is a distinct, expected state — not a bug to render as an error.
 */
export function isUnreachable(error: unknown): boolean {
  return (
    isApiError(error) && (error.code === "NETWORK" || error.code === "TIMEOUT")
  );
}

export async function toApiError(response: Response): Promise<ApiError> {
  const payload = await response.json().catch(() => null);
  const parsed = apiErrorResponseSchema.safeParse(payload);
  if (parsed.success) {
    return new ApiError(
      parsed.data.error.code,
      parsed.data.error.message,
      response.status,
    );
  }
  return new ApiError(
    response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
    `Request failed (${response.status})`,
    response.status,
  );
}

/** Maps a failed `fetch` into the same `ApiError` shape as a non-2xx response. */
export function toTransportError(error: unknown): ApiError {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new ApiError("TIMEOUT", "API timed out", 0);
  }
  return new ApiError("NETWORK", "API unreachable", 0);
}
