export function parseOwnerEmails(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );
}

/** `MACROS_OWNER_EMAILS`, comma separated. Unset means nobody is the owner. */
export function isOwnerEmail(email: string): boolean {
  return parseOwnerEmails(process.env.MACROS_OWNER_EMAILS).has(
    email.trim().toLowerCase(),
  );
}
