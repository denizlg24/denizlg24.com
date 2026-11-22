"use client";

import { useSyncExternalStore } from "react";
import { ScreenReceiver } from "@/components/screen/receiver";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function readKey() {
  return window.location.hash.slice(1);
}

function reportStatus(status: "playing" | "ended") {
  const native = window as Window & {
    ReactNativeWebView?: { postMessage: (message: string) => void };
  };
  native.ReactNativeWebView?.postMessage(status);
}

export function NativeReceiver() {
  const key = useSyncExternalStore(subscribe, readKey, () => null);
  if (key === null) return null;
  if (!/^[\w-]{43}$/.test(key)) {
    return (
      <main className="grid min-h-screen place-items-center">
        Open Screen Share from the TV app.
      </main>
    );
  }
  return <ScreenReceiver key={key} receiverKey={key} onStatus={reportStatus} />;
}
