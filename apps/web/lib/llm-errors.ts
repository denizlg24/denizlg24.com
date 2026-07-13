// Typed failures for the central LLM service. Callers branch on these
// instead of parsing provider error strings.

/** A required server-side setting (e.g. AI_GATEWAY_API_KEY) is missing. */
export class LlmConfigurationError extends Error {
  readonly status = 500;
}

/** The requested model is unknown, not a language model, or lacks a required capability. */
export class LlmModelError extends Error {
  readonly status = 400;
}

/** The Gateway model catalog cannot be served (cold start with no stale copy). */
export class CatalogUnavailableError extends Error {
  readonly status = 503;
}

/** The upstream generation request failed or returned an unusable body. */
export class LlmTransportError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}
