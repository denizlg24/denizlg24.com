import { z } from "zod";

// Matches the server: Better Auth's default length bounds in apps/macros.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;

const emailSchema = z.email();

export function emailError(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") return "Enter your email address.";
  return emailSchema.safeParse(trimmed).success
    ? undefined
    : "Enter a valid email address.";
}

export function passwordError(value: string): string | undefined {
  if (value === "") return "Enter your password.";
  if (value.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return undefined;
}

export function nameError(value: string): string | undefined {
  return value.trim() === "" ? "Enter your name." : undefined;
}

/** iOS strong-password suggestions follow these when creating an account. */
export const PASSWORD_RULES = `minlength: ${MIN_PASSWORD_LENGTH}; maxlength: ${MAX_PASSWORD_LENGTH};`;
