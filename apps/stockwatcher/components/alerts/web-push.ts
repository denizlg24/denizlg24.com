"use client";

import { useSyncExternalStore } from "react";

/**
 * `home-screen`: iPhone or iPad in a Safari tab, where web push only works
 * once the site is added to the Home Screen and opened from there.
 */
export type PushSupport =
  | "pending"
  | "ready"
  | "denied"
  | "home-screen"
  | "unsupported";

const appleTouch = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);

const standalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  window.matchMedia("(display-mode: fullscreen)").matches;

function read(): PushSupport {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    return appleTouch() && !standalone() ? "home-screen" : "unsupported";
  return Notification.permission === "denied" ? "denied" : "ready";
}

// Permission can change in browser settings while the page stays open.
function subscribe(update: () => void) {
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  return () => {
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", update);
  };
}

export function usePushSupport(): PushSupport {
  return useSyncExternalStore(subscribe, read, () => "pending" as const);
}

/** A name for this device, so several push channels can be told apart. */
export function deviceName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : null;
  const device = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser && device) return `${browser} on ${device}`;
  return device ?? browser ?? "This browser";
}

function decodeKey(base64url: string) {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array) {
  if (!current || current.byteLength !== wanted.byteLength) return false;
  const bytes = new Uint8Array(current);
  return bytes.every((byte, i) => byte === wanted[i]);
}

export type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Undo a subscription this call created when saving it fails. */
  discard: () => Promise<void>;
};

/**
 * Asks for permission, registers the service worker and subscribes. Must be
 * called straight from a click: Safari refuses the permission prompt after
 * an await.
 */
export async function subscribePush(publicKey: string): Promise<PushTarget> {
  const permission = await Notification.requestPermission();
  if (permission === "denied")
    throw new Error(
      "Notifications are blocked for this site. Allow them in your browser’s site settings, then reload the page.",
    );
  if (permission !== "granted")
    throw new Error(
      "Notifications weren’t allowed. Press the button again and choose Allow.",
    );
  await navigator.serviceWorker.register("/push-sw.js", { scope: "/" });
  const registration = await navigator.serviceWorker.ready;
  const key = decodeKey(publicKey);
  let subscription = await registration.pushManager.getSubscription();
  let fresh = false;
  if (
    subscription &&
    !sameKey(subscription.options.applicationServerKey, key)
  ) {
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
    fresh = true;
  }
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth)
    throw new Error("This browser didn’t return a push address. Try again.");
  const created = subscription;
  return {
    endpoint: json.endpoint,
    p256dh,
    auth,
    discard: async () => {
      if (fresh) await created.unsubscribe().catch(() => false);
    },
  };
}
