// This is installed by the desktop host before Stream loads, after native
// protection has been configured. User-agent strings are not a capability check.
export function embedEnvironment(): "native" | "web" {
  const capability = Object.getOwnPropertyDescriptor(
    window,
    "__STREAM_NATIVE_BLOCKER__",
  );
  return window.top === window &&
    capability?.value === 1 &&
    capability.writable === false &&
    capability.configurable === false
    ? "native"
    : "web";
}

export function serverEmbedEnvironment(): "pending" {
  return "pending";
}

export function subscribeEmbedEnvironment() {
  // The native host installs its capability before any application script runs.
  return () => {};
}
