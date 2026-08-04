import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { IAuthenticatorExportAccount } from "@repo/schemas";
import type { NewAccountInput } from "./entries";
import { createEntry, emptyPayload } from "./entries";
import {
  DEFAULT_PREFERENCES,
  type Preferences,
  type VaultPayload,
} from "./types";

/**
 * The sync engine is exercised against stubbed storage and API modules: the
 * merge rules are the part worth pinning down, and standing up a fake
 * `browser.storage` would only test the polyfill.
 */

const KEY = {} as CryptoKey;

let vault: VaultPayload;
let preferences: Preferences;
let remoteAccounts: IAuthenticatorExportAccount[];
let created: NewAccountInput[];
let patched: { id: string; label: string }[];
let deleted: string[];
let nextCreateFailure: Error | null;
let nextPatchFailure: Error | null;
let nextDeleteFailure: Error | null;

const actualApi = await import("./api");

mock.module("./vault", () => ({
  readVault: async () => structuredClone(vault),
  writeVault: async (_key: CryptoKey, payload: VaultPayload) => {
    vault = structuredClone(payload);
  },
}));

mock.module("./storage", () => ({
  readPreferences: async () => preferences,
  writePreferences: async (patch: Partial<Preferences>) => {
    preferences = { ...preferences, ...patch };
    return preferences;
  },
}));

mock.module("./api", () => ({
  ...actualApi,
  fetchExport: async () => ({
    accounts: structuredClone(remoteAccounts),
    exportedAt: new Date().toISOString(),
  }),
  createRemoteAccount: async (_config: unknown, input: NewAccountInput) => {
    if (nextCreateFailure) throw nextCreateFailure;
    created.push(input);
    const account = {
      _id: `server-${created.length}`,
      label: input.label,
      issuer: input.issuer,
      accountName: input.accountName,
      algorithm: input.algorithm,
      digits: input.digits,
      period: input.period,
      secret: input.secret,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    remoteAccounts.push(account);
    return { account };
  },
  updateRemoteAccount: async (
    _config: unknown,
    id: string,
    patch: { label: string; issuer: string; accountName: string },
  ) => {
    if (nextPatchFailure) throw nextPatchFailure;
    patched.push({ id, label: patch.label });
    const target = remoteAccounts.find((account) => account._id === id);
    if (target) {
      Object.assign(target, patch, { updatedAt: "2026-02-01T00:00:00.000Z" });
    }
    return {
      account: { ...target, ...patch, updatedAt: "2026-02-01T00:00:00.000Z" },
    };
  },
  deleteRemoteAccount: async (_config: unknown, id: string) => {
    if (nextDeleteFailure) throw nextDeleteFailure;
    deleted.push(id);
    remoteAccounts = remoteAccounts.filter((account) => account._id !== id);
    return { success: true };
  },
}));

const { syncVault } = await import("./sync");

function remoteAccount(
  overrides: Partial<IAuthenticatorExportAccount> = {},
): IAuthenticatorExportAccount {
  return {
    _id: "remote-1",
    label: "GitHub",
    issuer: "GitHub",
    accountName: "deniz@example.com",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: "GEZDGNBVGY3TQOJQ",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function localEntry(overrides = {}) {
  return {
    ...createEntry({
      label: "GitHub",
      issuer: "GitHub",
      accountName: "deniz@example.com",
      secret: "GEZDGNBVGY3TQOJQ",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }),
    ...overrides,
  };
}

beforeEach(() => {
  vault = emptyPayload("test-api-key");
  preferences = { ...DEFAULT_PREFERENCES };
  remoteAccounts = [];
  created = [];
  patched = [];
  deleted = [];
  nextCreateFailure = null;
  nextPatchFailure = null;
  nextDeleteFailure = null;
});

describe("syncVault", () => {
  test("refuses to run without an API key", async () => {
    vault = emptyPayload("");
    expect(syncVault(KEY)).rejects.toThrow("No API key");
  });

  test("pulls unknown accounts, secrets included", async () => {
    remoteAccounts = [remoteAccount(), remoteAccount({ _id: "remote-2" })];

    const result = await syncVault(KEY);

    expect(result.added).toBe(2);
    expect(vault.entries).toHaveLength(2);
    expect(vault.entries[0]?.secret).toBe("GEZDGNBVGY3TQOJQ");
    expect(vault.entries[0]?.pendingPush).toBe(false);
    expect(preferences.lastSyncAt).not.toBeNull();
  });

  test("pushes a locally created account and adopts the server id", async () => {
    vault = { ...vault, entries: [localEntry({ label: "Offline" })] };

    const result = await syncVault(KEY);

    expect(created).toHaveLength(1);
    expect(created[0]?.label).toBe("Offline");
    expect(result.pushed).toBe(1);
    expect(vault.entries[0]?.serverId).toBe("server-1");
    expect(vault.entries[0]?.pendingPush).toBe(false);
    // The push happens before the pull, so it is not re-added as a new account.
    expect(vault.entries).toHaveLength(1);
    expect(result.added).toBe(0);
  });

  test("pushes a rename without touching the secret", async () => {
    remoteAccounts = [remoteAccount()];
    vault = {
      ...vault,
      entries: [
        localEntry({
          serverId: "remote-1",
          serverUpdatedAt: "2026-01-01T00:00:00.000Z",
          label: "Renamed",
          pendingPush: true,
        }),
      ],
    };

    await syncVault(KEY);

    expect(patched).toEqual([{ id: "remote-1", label: "Renamed" }]);
    expect(vault.entries[0]?.label).toBe("Renamed");
    expect(vault.entries[0]?.pendingPush).toBe(false);
  });

  test("applies a remote edit when nothing is pending locally", async () => {
    remoteAccounts = [
      remoteAccount({
        label: "GitHub Work",
        secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
        updatedAt: "2026-03-01T00:00:00.000Z",
      }),
    ];
    vault = {
      ...vault,
      entries: [
        localEntry({
          serverId: "remote-1",
          serverUpdatedAt: "2026-01-01T00:00:00.000Z",
          pendingPush: false,
        }),
      ],
    };

    const result = await syncVault(KEY);

    expect(result.updated).toBe(1);
    expect(vault.entries[0]?.label).toBe("GitHub Work");
    expect(vault.entries[0]?.secret).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  test("mirrors a server-side delete into the trash instead of dropping it", async () => {
    vault = {
      ...vault,
      entries: [
        localEntry({
          serverId: "remote-1",
          serverUpdatedAt: "2026-01-01T00:00:00.000Z",
          pendingPush: false,
        }),
      ],
    };

    const result = await syncVault(KEY);

    expect(result.trashed).toBe(1);
    expect(vault.entries).toHaveLength(0);
    expect(vault.trash[0]?.reason).toBe("remote");
    // The secret survives the server losing it — the point of the local vault.
    expect(vault.trash[0]?.secret).toBe("GEZDGNBVGY3TQOJQ");
  });

  test("flushes a delete made offline", async () => {
    const entry = localEntry({ serverId: "remote-1", pendingDelete: true });
    remoteAccounts = [remoteAccount()];
    vault = {
      ...vault,
      trash: [
        { ...entry, deletedAt: new Date().toISOString(), reason: "local" },
      ],
    };

    const result = await syncVault(KEY);

    expect(deleted).toEqual(["remote-1"]);
    expect(result.pushed).toBe(1);
    expect(vault.trash[0]?.pendingDelete).toBe(false);
  });

  test("treats a 404 on delete as already done", async () => {
    nextDeleteFailure = new actualApi.ApiError("gone", 404);
    const entry = localEntry({ serverId: "remote-1", pendingDelete: true });
    vault = {
      ...vault,
      trash: [
        { ...entry, deletedAt: new Date().toISOString(), reason: "local" },
      ],
    };

    await syncVault(KEY);

    expect(vault.trash[0]?.pendingDelete).toBe(false);
  });

  test("takes an account back out of the trash when it returns upstream", async () => {
    const entry = localEntry({ serverId: "remote-1", pendingDelete: false });
    remoteAccounts = [remoteAccount()];
    vault = {
      ...vault,
      trash: [
        { ...entry, deletedAt: new Date().toISOString(), reason: "remote" },
      ],
    };

    const result = await syncVault(KEY);

    expect(result.added).toBe(1);
    expect(vault.trash).toHaveLength(0);
    expect(vault.entries[0]?.serverId).toBe("remote-1");
  });

  test("purges trash past the retention window", async () => {
    const entry = localEntry({ serverId: "remote-1", pendingDelete: false });
    vault = {
      ...vault,
      trash: [
        { ...entry, deletedAt: "2020-01-01T00:00:00.000Z", reason: "remote" },
      ],
    };

    const result = await syncVault(KEY);

    expect(result.purged).toBe(1);
    expect(vault.trash).toHaveLength(0);
  });

  test("leaves an unreachable server's vault untouched", async () => {
    nextCreateFailure = new actualApi.OfflineError();
    const before = structuredClone({ ...vault, entries: [localEntry()] });
    vault = structuredClone(before);

    expect(syncVault(KEY)).rejects.toThrow("Could not reach the server");
    expect(vault).toEqual(before);
  });
});
