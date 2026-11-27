/** The gateway's budget refusal, however the SDK wrapped it. */
export function isQuotaExceeded(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const text = [
      "message" in current ? current.message : undefined,
      "responseBody" in current ? current.responseBody : undefined,
      "type" in current ? current.type : undefined,
    ]
      .filter((part) => typeof part === "string")
      .join(" ");
    if (text.includes("quota_for_entity_exceeded")) return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return (
    typeof error === "string" && error.includes("quota_for_entity_exceeded")
  );
}
