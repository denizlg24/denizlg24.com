/**
 * Code generation, done locally.
 *
 * The whole point of the vault is that codes never depend on the server being
 * reachable, so this runs against the stored base32 secret using the same
 * `otpauth` implementation the server uses — same library, same results.
 */

import * as OTPAuth from "otpauth";
import type { TotpAlgorithm, VaultEntry } from "./types";

export interface GeneratedCode {
  code: string;
  /** Seconds left on the current step. */
  remaining: number;
  period: number;
}

export type TotpParameters = Pick<
  VaultEntry,
  "secret" | "algorithm" | "digits" | "period"
>;

export function generateCode(
  params: TotpParameters,
  now: number = Date.now(),
): GeneratedCode {
  const totp = new OTPAuth.TOTP({
    secret: OTPAuth.Secret.fromBase32(params.secret),
    algorithm: params.algorithm,
    digits: params.digits,
    period: params.period,
  });

  const seconds = Math.floor(now / 1000);

  return {
    code: totp.generate({ timestamp: now }),
    remaining: params.period - (seconds % params.period),
    period: params.period,
  };
}

/** "123456" → "123 456"; keeps six- and eight-digit codes both readable. */
export function formatCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

/** Throws if the secret is not decodable base32, which is the only way a stored
 *  entry can be structurally broken. */
export function assertValidSecret(
  secret: string,
  algorithm: TotpAlgorithm,
  digits: number,
  period: number,
): void {
  generateCode({ secret, algorithm, digits, period });
}
