"use client";

/**
 * `twoFactor.enable` re-checks the password, so the enrollment page needs it
 * again after sign-in navigates there. Keeping it in a module variable rather
 * than sessionStorage means it never touches persistent storage and dies with
 * the tab; a same-tab `router.replace` keeps JS memory, so nothing is lost.
 * A reload drops it and the page falls back to asking.
 */
let password: string | null = null;

export function stashEnrollPassword(value: string): void {
  password = value;
}

export function takeEnrollPassword(): string | null {
  const value = password;
  password = null;
  return value;
}
