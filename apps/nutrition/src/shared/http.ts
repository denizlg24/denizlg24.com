export interface SuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId: string;
}

export const ok = <T>(data: T, requestId: string): SuccessResponse<T> => ({
  success: true,
  data,
  requestId,
});

export const fail = (
  error: ErrorResponse["error"],
  requestId: string,
): ErrorResponse => ({
  success: false,
  error,
  requestId,
});
