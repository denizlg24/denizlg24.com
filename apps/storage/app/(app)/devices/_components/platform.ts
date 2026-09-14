import type { SmbPlatform } from "@repo/schemas/cloud";
import {
  HardDrive,
  Laptop,
  type LucideIcon,
  Monitor,
  Smartphone,
  Terminal,
} from "lucide-react";
import { SMB_HOST } from "@/lib/env";

export const PLATFORMS: {
  value: SmbPlatform;
  label: string;
  /** Fills the default device name: "Ana's Mac". */
  noun: string;
  icon: LucideIcon;
}[] = [
  { icon: Laptop, label: "Mac", noun: "Mac", value: "mac" },
  { icon: Monitor, label: "Windows", noun: "PC", value: "windows" },
  { icon: Smartphone, label: "iPhone or iPad", noun: "iPhone", value: "ios" },
  { icon: Terminal, label: "Linux", noun: "computer", value: "linux" },
];

export function platformInfo(platform: SmbPlatform | null | undefined) {
  return (
    PLATFORMS.find((entry) => entry.value === platform) ?? {
      icon: HardDrive,
      label: "Device",
      noun: "computer",
      value: "other" as const,
    }
  );
}

/** A guess from the browser, which the person can correct. */
export function detectPlatform(): SmbPlatform {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  // iPadOS Safari reports itself as a Mac; a touch-capable "Mac" is an iPad.
  if (/Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "ios" : "mac";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux|X11/.test(ua) && !/Android/.test(ua)) return "linux";
  return "other";
}

/**
 * Two drives rather than one. The namespace root holds both as folders, but
 * its top level is synthetic: nothing can be created directly in it, so a
 * single mount would show a writable-looking root that rejects every write.
 * Samba exports them as `Personal` and `Shared`; the app calls the second
 * one Family.
 */
export const DRIVES = [
  { label: "Your files", share: "Personal" },
  { label: "Family", share: "Shared" },
] as const;

export type Drive = (typeof DRIVES)[number];

export function smbUrl(drive: Drive, principal?: string | null): string {
  const user = principal ? `${encodeURIComponent(principal)}@` : "";
  return `smb://${user}${SMB_HOST}/${drive.share}`;
}

export function uncPath(drive: Drive): string {
  return `\\\\${SMB_HOST}\\${drive.share}`;
}

function downloadText(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * A Finder "internet location" is a plist with one URL. Double-clicking it
 * opens Connect to Server with the address filled in, so the only thing left
 * to type is the password. Made in the browser: the file holds no secret.
 */
export function downloadMacShortcut(drive: Drive, principal: string): void {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>URL</key>
\t<string>${xmlEscape(smbUrl(drive, principal))}</string>
</dict>
</plist>
`;
  downloadText(`Deniz Cloud – ${drive.label}.inetloc`, body, "application/xml");
}

/**
 * A batch file that maps both drives on the next free letters and asks for
 * the password itself. `persistent:yes` keeps them across sign-ins.
 */
export function downloadWindowsShortcut(principal: string): void {
  const lines = [
    "@echo off",
    "echo Connecting Deniz Cloud...",
    ...DRIVES.map(
      (drive) =>
        `net use * "${uncPath(drive)}" /user:${principal} /persistent:yes`,
    ),
    "echo.",
    "echo Done. Both drives are under This PC.",
    "pause",
    "",
  ];
  downloadText("Connect Deniz Cloud.cmd", lines.join("\r\n"), "text/plain");
}

export const TAILSCALE_DOWNLOAD: Record<SmbPlatform, string> = {
  ios: "https://apps.apple.com/app/tailscale/id1470499037",
  linux: "https://tailscale.com/download/linux",
  mac: "https://apps.apple.com/app/tailscale/id1475387142",
  other: "https://tailscale.com/download",
  windows: "https://tailscale.com/download/windows",
};
