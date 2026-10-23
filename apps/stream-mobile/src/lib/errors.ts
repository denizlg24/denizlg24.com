/** The server answered and refused. `code` is the body's `error`, e.g. `not_a_member`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(code ?? `Request failed (${status})`);
    this.name = "ApiError";
  }
}

/** The request never reached Stream, or the sign-in service was unreachable. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Offline", { cause });
    this.name = "NetworkError";
  }
}

export function isApiError(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}
