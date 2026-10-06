export interface AuthStorage {
  get(key: string): string | null | Promise<string | null>;
  set(key: string, value: string): void | Promise<void>;
  remove(key: string): void | Promise<void>;
}

/** Nothing survives a reload; for tests and short-lived tools. */
export function memoryStorage(): AuthStorage {
  const values = new Map<string, string>();
  return {
    get: (key) => values.get(key) ?? null,
    set: (key, value) => {
      values.set(key, value);
    },
    remove: (key) => {
      values.delete(key);
    },
  };
}

/**
 * `localStorage`, so a sign-in survives the redirect to the issuer and back.
 * Anything script on the page can read is readable here too — the refresh
 * token included. For a web app with a server, prefer the Next entry, which
 * keeps tokens in an HttpOnly cookie.
 */
export function browserStorage(): AuthStorage {
  return {
    get: (key) => globalThis.localStorage.getItem(key),
    set: (key, value) => globalThis.localStorage.setItem(key, value),
    remove: (key) => globalThis.localStorage.removeItem(key),
  };
}
