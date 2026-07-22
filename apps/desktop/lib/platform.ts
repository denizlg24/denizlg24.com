/**
 * Platform seam: lets the same app run inside Tauri and in a plain browser.
 *
 * `isTauri()` feature-detects the Tauri webview without importing any Tauri
 * module (so it is safe in every environment). `platformFetch` resolves the
 * correct fetch at call time — Tauri's `plugin-http` (which bypasses CORS and
 * drives its response stream over Tauri's IPC) inside the app, native `fetch`
 * everywhere else. Resolving per call avoids any bootstrap-ordering hazard
 * across the many `new denizApi()` call sites.
 */

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function prepareTauriFetchInit(
  init?: RequestInit,
): RequestInit | undefined {
  return init ? { ...init, signal: undefined } : undefined;
}

export async function platformFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  if (isTauri()) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    // plugin-http 2.5.9 can try to release the same Rust response-body
    // resource more than once when an AbortSignal fires while the stream is
    // being read. Its fire-and-forget cleanup then surfaces as an unhandled
    // "resource id is invalid" rejection. Requests still complete normally;
    // callers suppress stale results using the same signal after decoding.
    const tauriInit = prepareTauriFetchInit(init);
    return tauriFetch(input, tauriInit);
  }
  return fetch(input, init);
}
