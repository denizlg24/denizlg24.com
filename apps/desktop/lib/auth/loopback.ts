const CALLBACK_EVENT = "oauth-callback";

export interface RedirectListener {
  redirectUri: string;
  /** The full callback URL, once the browser has been sent to it. */
  callback: Promise<URL>;
}

/**
 * Asks the Tauri side to bind an ephemeral loopback port and relays the one
 * request it accepts. The event listener is registered before the port is
 * opened, so the browser cannot land on the callback before anything is
 * waiting for it.
 */
export async function listenForRedirect(
  signal: AbortSignal,
): Promise<RedirectListener> {
  const { invoke } = await import("@tauri-apps/api/core");
  const { listen } = await import("@tauri-apps/api/event");

  let settle: ((url: URL) => void) | null = null;
  let fail: ((reason: unknown) => void) | null = null;
  const callback = new Promise<URL>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  const unlisten = await listen<string>(CALLBACK_EVENT, (event) => {
    settle?.(new URL(event.payload));
  });
  const onAbort = () => fail?.(signal.reason);
  signal.addEventListener("abort", onAbort, { once: true });
  const cleanup = () => {
    unlisten();
    signal.removeEventListener("abort", onAbort);
  };
  callback.then(cleanup, cleanup);

  const port = await invoke<number>("oauth_listen");
  return { redirectUri: `http://127.0.0.1:${port}/callback`, callback };
}
