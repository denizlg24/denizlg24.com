import type { PlatformBridge } from "@repo/admin/platform";
import { isTauri } from "./platform";

/** Desktop PlatformBridge: Tauri plugins inside the app, browser APIs in dev. */
export const desktopPlatform: PlatformBridge = {
  async openExternal(url) {
    if (isTauri()) {
      const { open } = await import("@tauri-apps/plugin-shell");
      await open(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  },

  navigate(path) {
    window.location.assign(`/dashboard${path}`);
  },

  async copyText(text) {
    if (isTauri()) {
      const { writeText } = await import(
        "@tauri-apps/plugin-clipboard-manager"
      );
      await writeText(text);
      return;
    }
    await navigator.clipboard.writeText(text);
  },

  async notify(title, body) {
    if (isTauri()) {
      const { isPermissionGranted, requestPermission, sendNotification } =
        await import("@tauri-apps/plugin-notification");
      let granted = await isPermissionGranted();
      if (!granted) granted = (await requestPermission()) === "granted";
      if (granted) sendNotification({ title, body });
      return;
    }
    if ("Notification" in window && Notification.permission === "granted") {
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
    anchor.click();
    URL.revokeObjectURL(url);
  },
};
