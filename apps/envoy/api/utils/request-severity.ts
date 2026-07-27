export type RequestSeverity = "success" | "client-error" | "server-error";

/**
 * Classifies an HTTP status code by who is responsible for it.
 *
 * - 5xx: the API itself failed -> "server-error" (degrades service status)
 * - 4xx: the caller sent a bad/unauthorized request -> "client-error"
 *        (the API behaved correctly; never degrades status)
 * - otherwise: "success"
 */
export function classifyStatus(statusCode: number): RequestSeverity {
  if (statusCode >= 500) return "server-error";
  if (statusCode >= 400) return "client-error";
  return "success";
}

/** A server-side failure: the only kind that should degrade service status. */
export function isServerError(statusCode: number): boolean {
  return statusCode >= 500;
}

/** A request that did not fail on the server (2xx/3xx or a client error). */
export function isHealthyForStatus(statusCode: number): boolean {
  return statusCode < 500;
}
