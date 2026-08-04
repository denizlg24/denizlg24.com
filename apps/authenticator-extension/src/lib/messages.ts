/**
 * The popup/options ↔ background contract.
 *
 * Reads happen directly in each page (decrypting with the shared session key),
 * but every *write* goes through here so the background stays the single writer
 * and a periodic sync can never interleave with a user edit.
 */

import { browser } from "./browser";
import type { EntryEdit, NewAccountInput } from "./entries";
import type { Preferences, SyncResult, VaultRecord } from "./types";

export type ExtensionRequest =
  | {
      type: "setup";
      apiBaseUrl: string;
      apiKey: string;
      passphrase: string;
    }
  | { type: "sync" }
  | { type: "addAccounts"; inputs: NewAccountInput[] }
  | { type: "editAccount"; id: string; edit: EntryEdit }
  | { type: "deleteAccount"; id: string }
  | { type: "restoreAccount"; id: string }
  | { type: "purgeTrashEntry"; id: string }
  | { type: "emptyTrash" }
  | { type: "changePassphrase"; passphrase: string }
  | { type: "updateCredentials"; apiBaseUrl: string; apiKey: string }
  | { type: "updatePreferences"; patch: Partial<Preferences> }
  | { type: "replaceVault"; record: VaultRecord }
  | { type: "reset" }
  | { type: "lock" };

export interface ResponseMap {
  setup: SyncResult;
  sync: SyncResult;
  addAccounts: { added: number };
  editAccount: null;
  deleteAccount: null;
  restoreAccount: null;
  purgeTrashEntry: null;
  emptyTrash: null;
  changePassphrase: null;
  updateCredentials: null;
  updatePreferences: Preferences;
  replaceVault: null;
  reset: null;
  lock: null;
}

export type ExtensionResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; name: string };

/** Rethrows background failures on the caller's side with the original name. */
export class BackgroundError extends Error {
  constructor(message: string, name: string) {
    super(message);
    this.name = name;
  }
}

export async function send<T extends ExtensionRequest>(
  request: T,
): Promise<ResponseMap[T["type"]]> {
  const response = (await browser.runtime.sendMessage(
    request,
  )) as ExtensionResponse<ResponseMap[T["type"]]>;

  if (!response) {
    throw new BackgroundError("Background did not respond", "BackgroundError");
  }
  if (!response.ok) {
    throw new BackgroundError(response.error, response.name);
  }

  return response.data;
}
