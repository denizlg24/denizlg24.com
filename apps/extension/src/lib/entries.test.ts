import { describe, expect, test } from "bun:test";
import {
  applyEdit,
  createEntry,
  emptyPayload,
  markForDeletion,
  purgeExpiredTrash,
  purgeFromTrash,
  restoreFromTrash,
} from "./entries";
import type { TrashedEntry, VaultEntry, VaultPayload } from "./types";

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
  return {
    ...createEntry({
      label: "GitHub",
      issuer: "GitHub",
      accountName: "deniz@example.com",
      secret: "gezdgnbv gy3tqojq",
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    }),
    ...overrides,
  };
}

function payload(overrides: Partial<VaultPayload> = {}): VaultPayload {
  return { ...emptyPayload("key"), ...overrides };
}

describe("createEntry", () => {
  test("normalises the secret and marks it for push", () => {
    const created = entry();
    expect(created.secret).toBe("GEZDGNBVGY3TQOJQ");
    expect(created.serverId).toBeNull();
    expect(created.pendingPush).toBe(true);
    expect(created.pendingDelete).toBe(false);
  });
});

describe("applyEdit", () => {
  test("queues a push and leaves the secret alone", () => {
    const original = entry({ pendingPush: false, serverId: "abc" });
    const edited = applyEdit(original, {
      label: "GH",
      issuer: "GitHub",
      accountName: "other@example.com",
    });

    expect(edited.label).toBe("GH");
    expect(edited.secret).toBe(original.secret);
    expect(edited.pendingPush).toBe(true);
  });
});

describe("markForDeletion", () => {
  test("moves the entry to trash with the delete still pending", () => {
    const target = entry({ serverId: "abc" });
    const result = markForDeletion(payload({ entries: [target] }), target.id);

    expect(result.entries).toHaveLength(0);
    expect(result.trash).toHaveLength(1);
    expect(result.trash[0]?.reason).toBe("local");
    expect(result.trash[0]?.pendingDelete).toBe(true);
  });

  test("ignores an unknown id", () => {
    const before = payload({ entries: [entry()] });
    expect(markForDeletion(before, "missing")).toBe(before);
  });
});

describe("restoreFromTrash", () => {
  test("a remotely deleted account comes back as local-only", () => {
    const trashed: TrashedEntry = {
      ...entry({
        serverId: "abc",
        serverUpdatedAt: "2026-01-01T00:00:00.000Z",
        pendingPush: false,
      }),
      deletedAt: "2026-01-02T00:00:00.000Z",
      reason: "remote",
    };

    const result = restoreFromTrash(payload({ trash: [trashed] }), trashed.id);
    const restored = result.entries[0];

    expect(result.trash).toHaveLength(0);
    expect(restored?.serverId).toBeNull();
    expect(restored?.serverUpdatedAt).toBeNull();
    expect(restored?.pendingPush).toBe(true);
  });

  test("a locally deleted account keeps its server id", () => {
    const trashed: TrashedEntry = {
      ...entry({ serverId: "abc", pendingDelete: true }),
      deletedAt: "2026-01-02T00:00:00.000Z",
      reason: "local",
    };

    const result = restoreFromTrash(payload({ trash: [trashed] }), trashed.id);
    const restored = result.entries[0];

    expect(restored?.serverId).toBe("abc");
    expect(restored?.pendingDelete).toBe(false);
    expect(restored?.pendingPush).toBe(true);
  });
});

describe("purgeFromTrash", () => {
  test("removes only the named entry", () => {
    const first: TrashedEntry = {
      ...entry(),
      deletedAt: "2026-01-01T00:00:00.000Z",
      reason: "remote",
    };
    const second: TrashedEntry = {
      ...entry(),
      deletedAt: "2026-01-01T00:00:00.000Z",
      reason: "remote",
    };

    const result = purgeFromTrash(
      payload({ trash: [first, second] }),
      first.id,
    );
    expect(result.trash).toEqual([second]);
  });
});

describe("purgeExpiredTrash", () => {
  const now = Date.parse("2026-02-01T00:00:00.000Z");

  test("drops entries past the retention window", () => {
    const stale: TrashedEntry = {
      ...entry({ pendingDelete: false }),
      deletedAt: "2026-01-01T00:00:00.000Z",
      reason: "remote",
    };
    const fresh: TrashedEntry = {
      ...entry({ pendingDelete: false }),
      deletedAt: "2026-01-28T00:00:00.000Z",
      reason: "remote",
    };

    const result = purgeExpiredTrash(
      payload({ trash: [stale, fresh] }),
      30,
      now,
    );

    expect(result.purged).toBe(1);
    expect(result.payload.trash).toEqual([fresh]);
  });

  test("keeps a delete that has not reached the server yet", () => {
    const unsent: TrashedEntry = {
      ...entry({ serverId: "abc", pendingDelete: true }),
      deletedAt: "2025-01-01T00:00:00.000Z",
      reason: "local",
    };

    const result = purgeExpiredTrash(payload({ trash: [unsent] }), 30, now);

    expect(result.purged).toBe(0);
    expect(result.payload.trash).toEqual([unsent]);
  });
});
