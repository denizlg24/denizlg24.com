import type { PlatformBridge } from "@repo/admin/platform";

/** Web PlatformBridge: plain browser APIs. */
export const webPlatform: PlatformBridge = {
  openExternal(url) {
    window.open(url, "_blank", "noopener,noreferrer");
  },

  navigate(path) {
    window.location.assign(`/admin/dashboard${path}`);
  },

  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },

  async notify(title, body) {
    if (!("Notification" in window)) return;
    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }
    if (permission === "granted") {
      new Notification(title, body ? { body } : undefined);
    }
  },

  async downloadFile(filename, data, mimeType) {
    const blob =
      typeof data === "string"
        ? new Blob([data], { type: mimeType ?? "text/plain" })
        : data;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    globalThis.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
};
