// The passkey client reports a ceremony the browser ended — the user closed
// the prompt, it timed out, or a newer ceremony aborted it — as an error with
// one of these codes. None of them says anything the user needs to read.
const DISMISSED_CODES = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

// The client's error union only carries `code` on some members.
export function isPasskeyDismissed(error: object): boolean {
  return (
    "code" in error &&
    typeof error.code === "string" &&
    DISMISSED_CODES.has(error.code)
  );
}

/** A label for a new passkey from the platform that is about to hold it. */
export function defaultPasskeyName(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/Android/.test(userAgent)) return "Android";
  if (/Linux/.test(userAgent)) return "Linux";
  return "Passkey";
}

export function conditionalMediationAvailable(): Promise<boolean> {
  if (
    typeof PublicKeyCredential === "undefined" ||
    typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    return Promise.resolve(false);
  }
  return PublicKeyCredential.isConditionalMediationAvailable().catch(
    () => false,
  );
}
