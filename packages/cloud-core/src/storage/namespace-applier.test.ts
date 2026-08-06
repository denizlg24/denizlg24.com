import { describe, expect, it } from "bun:test";

import { MetadataClientError } from "./metadata-protocol";
import type { NamespaceEntry } from "./metadata-service";
import { type ApplierSource, applyWatchedPaths } from "./namespace-applier";
import type { ProjectionRepository } from "./namespace-projector";
import type { ProjectedRow, ReconcilePlan } from "./namespace-reconcile";

function entry(relativePath: string, kind: "file" | "folder"): NamespaceEntry {
  return {
    absolutePath: `/data/storage/${relativePath}`,
    kind,
    metadata: {
      createdAt: "2026-08-06T00:00:00.000Z",
      id: `id-${relativePath}`,
      mimeType: null,
      ownerId: "owner",
    },
    modifiedAt: new Date("2026-08-06T00:00:00.000Z"),
    protectedXattrHash: "hash",
    relativePath,
    sizeBytes: 1,
  };
}

function harness(options: {
  adoptions?: Record<string, NamespaceEntry>;
  entries?: Record<string, NamespaceEntry>;
  failures?: Record<string, MetadataClientError>;
  markers?: Record<string, string>;
  rows?: ProjectedRow[];
}) {
  const upserts: string[] = [];
  let reaped: ReconcilePlan | null = null;

  const source: ApplierSource = {
    async branchMarkers() {
      return options.markers ?? { "/mnt/ssd": "a", "/mnt/hdd": "b" };
    },
    async stat(relativePath) {
      const failure = options.failures?.[relativePath];
      if (failure) throw failure;
      const found = options.entries?.[relativePath];
      if (!found) throw new MetadataClientError("gone", "NOT_FOUND");
      return found;
    },
    async adopt(relativePath) {
      const adopted = options.adoptions?.[relativePath];
      if (!adopted) throw new MetadataClientError("no ancestor", "NO_IDENTITY");
      return {
        attribution: {
          fromRelativePath: "a",
          ownerId: "owner",
          via: "ancestor" as const,
        },
        entry: adopted,
      };
    },
  };

  const repository = {
    async applyReapPlan(plan: ReconcilePlan) {
      reaped = plan;
    },
    async findByPath(relativePath: string) {
      return (
        (options.rows ?? []).find((row) => row.relativePath === relativePath) ??
        null
      );
    },
    async upsertFile(value: NamespaceEntry) {
      upserts.push(`file:${value.relativePath}`);
    },
    async upsertFolder(value: NamespaceEntry) {
      upserts.push(`folder:${value.relativePath}`);
    },
  } as unknown as ProjectionRepository;

  return {
    repository,
    source,
    upserts,
    get reaped() {
      return reaped;
    },
  };
}

describe("applying watched paths", () => {
  it("upserts folders and files it can read", async () => {
    const context = harness({
      entries: {
        "a/b.txt": entry("a/b.txt", "file"),
        a: entry("a", "folder"),
      },
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a", "a/b.txt"],
    );
    expect(context.upserts).toEqual(["folder:a", "file:a/b.txt"]);
    expect(outcome.upserted).toBe(2);
    expect(outcome.removed).toBe(0);
  });

  it("removes a row only when the path is confirmed absent", async () => {
    const context = harness({
      rows: [{ id: "id-a/gone.txt", kind: "file", relativePath: "a/gone.txt" }],
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/gone.txt"],
    );
    expect(outcome.removed).toBe(1);
    expect(context.reaped?.reap).toHaveLength(1);
  });

  it("never removes a row for a path it merely failed to read", async () => {
    // UNAVAILABLE is the metadata service being unreachable, not the entry
    // being gone. Treating the two alike is how a fault becomes data loss.
    const context = harness({
      failures: {
        "a/unreadable.txt": new MetadataClientError("down", "UNAVAILABLE"),
      },
      rows: [
        {
          id: "id-a/unreadable.txt",
          kind: "file",
          relativePath: "a/unreadable.txt",
        },
      ],
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/unreadable.txt"],
    );
    expect(outcome.removed).toBe(0);
    expect(outcome.problems).toBe(1);
    expect(context.reaped).toBeNull();
  });

  it("withholds deletions when no branch can be proven mounted", async () => {
    // A branch dropping out makes every file on it look deleted. Without this
    // check a single unmount would reap the whole disk's worth of rows.
    const context = harness({
      markers: {},
      rows: [{ id: "id-a/gone.txt", kind: "file", relativePath: "a/gone.txt" }],
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/gone.txt"],
    );
    expect(outcome.removed).toBe(0);
    expect(outcome.withheld).toBe(1);
    expect(context.reaped).toBeNull();
  });

  it("ignores an absent path that was never projected", async () => {
    const context = harness({ rows: [] });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/never-existed.txt"],
    );
    expect(outcome).toEqual({
      adopted: 0,
      problems: 0,
      removed: 0,
      upserted: 0,
      withheld: 0,
    });
  });
});
