import { describe, expect, it } from "bun:test";

import { MetadataClientError } from "./metadata-client";
import type { MetadataEntryPayload } from "./metadata-protocol";
import {
  type ChecksumBackfillCandidate,
  type ChecksumBackfillOptions,
  type ChecksumBackfillRepository,
  runChecksumBackfill,
} from "./namespace-checksum-backfill";

const MIB = 1024 * 1024;

function entry(relativePath: string): MetadataEntryPayload {
  return {
    kind: "file",
    metadata: {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "11111111-1111-4111-8111-111111111111",
      ownerId: "22222222-2222-4222-8222-222222222222",
    },
    modifiedAt: "2026-01-01T00:00:00.000Z",
    protectedXattrHash: "",
    relativePath,
    sizeBytes: 1,
  };
}

function candidate(id: string, sizeBytes = MIB): ChecksumBackfillCandidate {
  return {
    absolutePath: `/data/storage/acct/${id}.bin`,
    id,
    relativePath: `acct/${id}.bin`,
    sizeBytes,
  };
}

interface Harness {
  repository: ChecksumBackfillRepository;
  client: {
    recordChecksum: (
      relativePath: string,
      checksum: string,
    ) => Promise<MetadataEntryPayload>;
    verify: (
      relativePath: string,
      expectedId: string,
    ) => Promise<MetadataEntryPayload>;
  };
  recorded: { id: string; checksum: string }[];
  stamped: { relativePath: string; checksum: string }[];
  hashedPaths: string[];
  options: ChecksumBackfillOptions;
}

function harness(
  candidates: ChecksumBackfillCandidate[],
  overrides: Partial<ChecksumBackfillOptions> = {},
  behaviour: {
    hash?: (absolutePath: string) => Promise<string>;
    verify?: (relativePath: string) => Promise<MetadataEntryPayload>;
    stamp?: (relativePath: string) => Promise<MetadataEntryPayload>;
  } = {},
): Harness {
  const recorded: { id: string; checksum: string }[] = [];
  const stamped: { relativePath: string; checksum: string }[] = [];
  const hashedPaths: string[] = [];
  const pending = new Set(candidates.map((row) => row.id));

  return {
    client: {
      recordChecksum: async (relativePath, checksum) => {
        if (behaviour.stamp) return behaviour.stamp(relativePath);
        stamped.push({ checksum, relativePath });
        return entry(relativePath);
      },
      verify: async (relativePath) =>
        behaviour.verify ? behaviour.verify(relativePath) : entry(relativePath),
    },
    hashedPaths,
    options: {
      backupRestoreActive: false,
      hash: async (absolutePath) => {
        if (behaviour.hash) return behaviour.hash(absolutePath);
        hashedPaths.push(absolutePath);
        return "a".repeat(64);
      },
      maxBytes: 1024 ** 4,
      maxFiles: 100,
      migrationModeEnabled: false,
      timeBudgetMs: 60_000,
      ...overrides,
    },
    recorded,
    repository: {
      countUnverified: async () => pending.size,
      listUnverified: async (limit) =>
        candidates.filter((row) => pending.has(row.id)).slice(0, limit),
      recordChecksum: async (id, checksum) => {
        recorded.push({ checksum, id });
        pending.delete(id);
      },
    },
    stamped,
  };
}

describe("runChecksumBackfill", () => {
  it("hashes an unverified file and stamps it through the socket", async () => {
    const test = harness([candidate("a")]);
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.hashed).toBe(1);
    expect(report.bytesHashed).toBe(MIB);
    expect(report.remaining).toBe(0);
    expect(report.exhausted).toBeNull();
    // The xattr is the authority and the projection is a cache of it, so both
    // are written — the row alone would be undone by the next scan.
    expect(test.stamped).toEqual([
      { checksum: "a".repeat(64), relativePath: "acct/a.bin" },
    ]);
    expect(test.recorded).toEqual([{ checksum: "a".repeat(64), id: "a" }]);
  });

  it("reads bytes through the resolved broker path", async () => {
    const test = harness([candidate("a")]);
    await runChecksumBackfill(test.repository, test.client, test.options);
    expect(test.hashedPaths).toEqual(["/data/storage/acct/a.bin"]);
  });

  it("does nothing at all when there is nothing unverified", async () => {
    const test = harness([]);
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );
    expect(report.pending).toBe(0);
    expect(report.hashed).toBe(0);
    expect(test.hashedPaths).toEqual([]);
  });

  it("refuses to run while bytes are being moved underneath it", async () => {
    for (const [key, blockedBy] of [
      ["migrationModeEnabled", "migration-mode"],
      ["backupRestoreActive", "backup-restore-active"],
    ] as const) {
      const test = harness([candidate("a")], { [key]: true });
      const report = await runChecksumBackfill(
        test.repository,
        test.client,
        test.options,
      );
      expect(report.blockedBy).toBe(blockedBy);
      expect(test.hashedPaths).toEqual([]);
    }
  });

  it("skips a row whose bytes are gone instead of deleting it", async () => {
    const test = harness([candidate("a")], undefined, {
      hash: async () => {
        throw Object.assign(new Error("no such file"), { code: "ENOENT" });
      },
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.skipped).toEqual([
      { reason: "missing", relativePath: "acct/a.bin" },
    ]);
    expect(report.hashed).toBe(0);
    expect(test.stamped).toEqual([]);
  });

  it("does not stamp a path a different entry has taken over", async () => {
    const test = harness([candidate("a")], undefined, {
      verify: async () => {
        throw new MetadataClientError("different entry", "ID_MISMATCH");
      },
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.skipped).toEqual([
      { reason: "identity-changed", relativePath: "acct/a.bin" },
    ]);
    expect(test.stamped).toEqual([]);
    expect(test.recorded).toEqual([]);
  });

  it("stops rather than hashing the namespace against a dead socket", async () => {
    const test = harness(
      [candidate("a"), candidate("b"), candidate("c")],
      undefined,
      {
        verify: async () => {
          throw new MetadataClientError("socket gone", "UNAVAILABLE");
        },
      },
    );
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.blockedBy).toBe("metadata-unavailable");
    expect(report.hashed).toBe(0);
    // One file paid for the discovery; the other two are not read at all.
    expect(test.hashedPaths).toHaveLength(1);
  });

  it("records a hash failure without stopping the run", async () => {
    const test = harness([candidate("a"), candidate("b")], undefined, {
      hash: async (absolutePath) => {
        if (absolutePath.endsWith("a.bin")) throw new Error("EIO");
        return "b".repeat(64);
      },
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.failures).toEqual([
      { message: "EIO", relativePath: "acct/a.bin" },
    ]);
    expect(report.hashed).toBe(1);
  });

  it("stops on the byte budget", async () => {
    const test = harness([candidate("a", 10 * MIB), candidate("b", 10 * MIB)], {
      maxBytes: 15 * MIB,
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.hashed).toBe(1);
    expect(report.exhausted).toBe("bytes");
    expect(report.remaining).toBe(1);
  });

  it("stops on the time budget", async () => {
    let clock = 0;
    const test = harness([candidate("a"), candidate("b"), candidate("c")], {
      now: () => {
        clock += 400;
        return clock;
      },
      timeBudgetMs: 1_000,
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.exhausted).toBe("time");
    expect(report.hashed).toBeLessThan(3);
  });

  it("reports the row cap, which the query applied before the loop saw it", async () => {
    const test = harness([candidate("a"), candidate("b"), candidate("c")], {
      maxFiles: 2,
    });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.hashed).toBe(2);
    expect(report.remaining).toBe(1);
    expect(report.exhausted).toBe("files");
  });

  it("writes nothing on a dry run but still counts the work", async () => {
    const test = harness([candidate("a"), candidate("b")], { dryRun: true });
    const report = await runChecksumBackfill(
      test.repository,
      test.client,
      test.options,
    );

    expect(report.hashed).toBe(2);
    expect(report.remaining).toBe(0);
    expect(test.hashedPaths).toEqual([]);
    expect(test.stamped).toEqual([]);
    expect(test.recorded).toEqual([]);
  });
});
