import type { TotpAlgorithm } from "@repo/schemas";

export type { TotpAlgorithm };

/**
 * One account as it lives inside the encrypted vault.
 *
 * `updatedAt` is the local clock, `serverUpdatedAt` is the value the server had
 * when this entry was last reconciled. Sync compares those two rather than
 * trusting either side's timestamp on its own.
 */
export interface VaultEntry {
  id: string;
  /** `null` until the account has been pushed upstream at least once. */
  serverId: string | null;
  label: string;
  issuer: string;
  accountName: string;
  /** Base32, as it came out of the otpauth URI. */
  secret: string;
  algorithm: TotpAlgorithm;
  digits: number;
  period: number;
  createdAt: string;
  updatedAt: string;
  serverUpdatedAt: string | null;
  /** Local create/edit that still has to reach the server. */
  pendingPush: boolean;
  /** Local delete that still has to reach the server. */
  pendingDelete: boolean;
}

export type TrashReason = "remote" | "local";

export interface TrashedEntry extends VaultEntry {
  deletedAt: string;
  /** "remote": vanished from the server. "local": deleted here. */
  reason: TrashReason;
}

/** Everything that is encrypted at rest. Never write any of this in clear. */
export interface VaultPayload {
  apiKey: string;
  entries: VaultEntry[];
  trash: TrashedEntry[];
}

export interface EncryptedBlob {
  iv: string;
  ciphertext: string;
}

export interface VaultRecord {
  version: 1;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    iterations: number;
    salt: string;
  };
  payload: EncryptedBlob;
  updatedAt: string;
}

export type ThemePreference = "system" | "light" | "dark";

/**
 * Readable while the vault is locked, so it holds nothing sensitive. The API
 * key lives in the vault; only the address it points at lives here, because the
 * background needs it to decide whether it even has host permission.
 *
 * The theme lives here too rather than in the vault so the popup can paint
 * correctly before it is unlocked.
 */
export interface Preferences {
  apiBaseUrl: string;
  theme: ThemePreference;
  autoLockMinutes: number;
  syncIntervalMinutes: number;
  trashRetentionDays: number;
  lastSyncAt: string | null;
  lastSyncError: string | null;
}

export const DEFAULT_PREFERENCES: Preferences = {
  apiBaseUrl: __DEFAULT_API_BASE_URL__,
  theme: "system",
  autoLockMinutes: 15,
  syncIntervalMinutes: 30,
  trashRetentionDays: 30,
  lastSyncAt: null,
  lastSyncError: null,
};

export interface SyncResult {
  added: number;
  updated: number;
  pushed: number;
  trashed: number;
  purged: number;
  at: string;
}
