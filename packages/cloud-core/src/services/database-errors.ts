export function isPostgresErrorCode(error: unknown, code: string): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (
    "code" in error &&
    typeof error.code === "string" &&
    error.code === code
  ) {
    return true;
  }
  return (
    error.cause instanceof Error &&
    "code" in error.cause &&
    typeof error.cause.code === "string" &&
    error.cause.code === code
  );
}
