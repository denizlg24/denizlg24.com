/**
 * Vault lifecycle: create, unlock, read, write, re-key.
 *
 * Callers hold a `CryptoKey` and pass it back in for every read and write; the
 * passphrase itself is used once at unlock and then forgotten. Operations on the
 * decrypted contents live in entries.ts.
 */

import {
  decryptJson,
  deriveKey,
  encryptJson,
  newSalt,
  PBKDF2_ITERATIONS,
} from "./crypto";
import { readVaultRecord, writeVaultRecord } from "./storage";
import type { VaultPayload, VaultRecord } from "./types";

export class VaultLockedError extends Error {
  constructor() {
    super("Vault is locked");
    this.name = "VaultLockedError";
  }
}

export class WrongPassphraseError extends Error {
  constructor() {
    super("Wrong passphrase");
    this.name = "WrongPassphraseError";
  }
}

async function seal(
  key: CryptoKey,
  payload: VaultPayload,
  kdf: VaultRecord["kdf"],
): Promise<VaultRecord> {
  return {
    version: 1,
    kdf,
    payload: await encryptJson(key, payload),
    updatedAt: new Date().toISOString(),
  };
}

export async function createVault(
  passphrase: string,
  payload: VaultPayload,
): Promise<CryptoKey> {
  const kdf = {
    name: "PBKDF2",
    hash: "SHA-256",
    iterations: PBKDF2_ITERATIONS,
    salt: newSalt(),
  } as const;

  const key = await deriveKey(passphrase, kdf.salt, kdf.iterations);
  await writeVaultRecord(await seal(key, payload, kdf));
  return key;
}

export async function unlockWithPassphrase(
  passphrase: string,
): Promise<{ key: CryptoKey; payload: VaultPayload }> {
  const record = await readVaultRecord();
  if (!record) throw new VaultLockedError();

  const key = await deriveKey(
    passphrase,
    record.kdf.salt,
    record.kdf.iterations,
  );

  try {
    // GCM authentication fails on a wrong key, so this doubles as the check.
    const payload = await decryptJson<VaultPayload>(key, record.payload);
    return { key, payload: normalizePayload(payload) };
  } catch {
    throw new WrongPassphraseError();
  }
}

export async function readVault(key: CryptoKey): Promise<VaultPayload> {
  const record = await readVaultRecord();
  if (!record) throw new VaultLockedError();

  try {
    return normalizePayload(
      await decryptJson<VaultPayload>(key, record.payload),
    );
  } catch {
    throw new WrongPassphraseError();
  }
}

export async function writeVault(
  key: CryptoKey,
  payload: VaultPayload,
): Promise<void> {
  const record = await readVaultRecord();
  if (!record) throw new VaultLockedError();
  await writeVaultRecord(await seal(key, payload, record.kdf));
}

/** Re-derives from a fresh salt and rewrites the blob under the new key. */
export async function changePassphrase(
  currentKey: CryptoKey,
  newPassphrase: string,
): Promise<CryptoKey> {
  const payload = await readVault(currentKey);
  return createVault(newPassphrase, payload);
}

/** Tolerates a payload written by an older build that lacked newer fields. */
function normalizePayload(payload: VaultPayload): VaultPayload {
  return {
    apiKey: payload.apiKey ?? "",
    entries: (payload.entries ?? []).map((entry) => ({
      ...entry,
      pendingPush: entry.pendingPush ?? false,
      pendingDelete: entry.pendingDelete ?? false,
      serverUpdatedAt: entry.serverUpdatedAt ?? null,
    })),
    trash: payload.trash ?? [],
  };
}
