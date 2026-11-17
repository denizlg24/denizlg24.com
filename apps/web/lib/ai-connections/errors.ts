export class AiConnectionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "AiConnectionError";
  }
}

/** Never include upstream messages: they may echo credentials or token responses. */
export function gatewayFailure(status?: number): AiConnectionError {
  if (status === 401)
    return new AiConnectionError(
      "authentication",
      "Gateway rejected the credential. Replace it or reconnect Vercel.",
      401,
    );
  if (status === 402)
    return new AiConnectionError(
      "balance",
      "Gateway has insufficient credits. Add credits in Vercel.",
      402,
    );
  if (status === 403)
    return new AiConnectionError(
      "permission",
      "Gateway access denied. Check the selected team and AI Gateway Use permission.",
      403,
    );
  return new AiConnectionError(
    "unavailable",
    "Gateway could not be verified. Try again later.",
    502,
  );
}
