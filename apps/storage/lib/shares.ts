"use client";

import { formatRelative } from "@repo/cloud-ui/format";
import type { ShareExpiresIn, StorageShare } from "@repo/schemas/cloud";
import { APP_URL } from "./env";

export const EXPIRY_OPTIONS: { value: ShareExpiresIn; label: string }[] = [
  { label: "1 day", value: "1d" },
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "Never", value: "never" },
];

export function shareUrl(token: string): string {
  return `${APP_URL}/s/${token}`;
}

/**
 * The server keeps only a hash of each link, so the link itself exists in
 * two places: wherever the person pasted it, and here. Remembering it per
 * browser is what lets "Copy link" work again tomorrow without minting a new
 * one and breaking the one already sent.
 */
const LINKS_KEY = "storage:share-links";
const LINKS_MAX = 200;

function readLinks(): Record<string, string> {
  try {
    const raw = window.localStorage.getItem(LINKS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function writeLinks(links: Record<string, string>): void {
  try {
    window.localStorage.setItem(LINKS_KEY, JSON.stringify(links));
  } catch {
    // Private mode or a full quota: the link still works, it just is not
    // remembered.
  }
}

export function rememberShareLink(shareId: string, token: string): void {
  const links = readLinks();
  delete links[shareId];
  const entries = [...Object.entries(links), [shareId, token]];
  writeLinks(Object.fromEntries(entries.slice(-LINKS_MAX)));
}

export function forgetShareLink(shareId: string): void {
  const links = readLinks();
  if (!(shareId in links)) return;
  delete links[shareId];
  writeLinks(links);
}

export function rememberedShareLink(shareId: string): string | null {
  const token = readLinks()[shareId];
  return token ? shareUrl(token) : null;
}

export function isLive(share: StorageShare): boolean {
  return share.status === "active" && !share.targetMissing;
}

export function expiryLabel(share: Pick<StorageShare, "expiresAt">): string {
  if (!share.expiresAt) return "Never expires";
  return `Expires ${formatRelative(share.expiresAt)}`;
}

export function opensLabel(
  share: Pick<StorageShare, "accessCount" | "lastAccessedAt">,
): string {
  if (share.accessCount === 0) return "Not opened yet";
  const times =
    share.accessCount === 1
      ? "opened once"
      : `opened ${share.accessCount} times`;
  return share.lastAccessedAt
    ? `${times} · last ${formatRelative(share.lastAccessedAt)}`
    : times;
}

export function statusLabel(share: StorageShare): string {
  if (share.targetMissing)
    return share.kind === "file" ? "File was deleted" : "Folder was deleted";
  if (share.status === "revoked")
    return `Stopped ${formatRelative(share.revokedAt)}`;
  if (share.status === "expired")
    return `Expired ${formatRelative(share.expiresAt)}`;
  return expiryLabel(share);
}
