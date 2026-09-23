// The passkey client reports a ceremony the browser ended — the user closed
// the prompt, it timed out, or a newer ceremony aborted it — as an error with
// one of these codes. None of them says anything the user needs to read.
const DISMISSED_CODES = new Set([
  "AUTH_CANCELLED",
  "ERROR_CEREMONY_ABORTED",
  "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY",
]);

// The client's error union only carries `code` on some members.
function errorCode(error: object): string | null {
  return "code" in error && typeof error.code === "string" ? error.code : null;
}

export function isPasskeyDismissed(error: object): boolean {
  const code = errorCode(error);
  return code !== null && DISMISSED_CODES.has(code);
}

/**
 * Registration lists the account's credentials as excluded, so an
 * authenticator that already holds one refuses to make another. It is the
 * only exact way to learn that this device has a passkey for the account.
 */
export function isPasskeyPreviouslyRegistered(error: object): boolean {
  return errorCode(error) === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED";
}

/**
 * The authenticator presented a credential the server has no record of — the
 * passkey was deleted from the account, or the key belongs to somebody else
 * on a shared device. It is the exact counterpart of
 * `isPasskeyPreviouslyRegistered`: proof that this browser's marker is wrong.
 * `AUTHENTICATION_FAILED` is deliberately not treated the same way, since a
 * failed assertion proves nothing about the stored credential.
 */
export function isPasskeyUnknownToServer(error: object): boolean {
  return errorCode(error) === "PASSKEY_NOT_FOUND";
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
