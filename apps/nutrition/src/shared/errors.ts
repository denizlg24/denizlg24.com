export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const isApiError = (error: unknown): error is ApiError =>
  error instanceof ApiError;

export const toError = (error: unknown) => {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
};
