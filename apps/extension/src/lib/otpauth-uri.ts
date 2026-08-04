/**
 * otpauth:// parsing, kept behaviourally identical to
 * `apps/web/lib/authenticator.ts` so an account imported here and one imported
 * on the server end up with the same label, issuer and account name.
 */

import * as OTPAuth from "otpauth";
import type { TotpAlgorithm } from "./types";

const VALID_ALGORITHMS: ReadonlySet<string> = new Set([
  "SHA1",
  "SHA256",
  "SHA512",
]);

function isTotpAlgorithm(value: string): value is TotpAlgorithm {
  return VALID_ALGORITHMS.has(value);
}

export interface ParsedOtpAuthUri {
  label: string;
  issuer: string;
  accountName: string;
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
}

export function parseOtpAuthUri(uri: string): ParsedOtpAuthUri {
  const parsed = OTPAuth.URI.parse(uri.trim());

  if (!(parsed instanceof OTPAuth.TOTP)) {
    throw new Error("Only TOTP URIs are supported");
  }

  const labelParts = parsed.label.split(":");
  const accountName =
    labelParts.length > 1 ? labelParts.slice(1).join(":").trim() : parsed.label;

  return {
    label: parsed.issuer || (labelParts[0] ?? parsed.label).trim(),
    issuer: parsed.issuer,
    accountName,
    secret: parsed.secret.base32,
    algorithm: isTotpAlgorithm(parsed.algorithm) ? parsed.algorithm : "SHA1",
    digits: parsed.digits || 6,
    period: parsed.period || 30,
  };
}

/** Splits pasted text into candidate URIs; tolerates one-per-line blobs. */
export function splitUriList(input: string): string[] {
  return input
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
