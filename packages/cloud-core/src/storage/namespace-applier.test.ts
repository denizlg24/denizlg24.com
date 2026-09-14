import { describe, expect, it } from "bun:test";

import { MetadataClientError } from "./metadata-protocol";
import type { NamespaceEntry } from "./metadata-service";
import {
  type ApplierSource,
  applyWatchedPaths,
  type IdentityClaim,
} from "./namespace-applier";
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
  claims?: Record<string, IdentityClaim>;
  entries?: Record<string, NamespaceEntry>;
  failures?: Record<string, MetadataClientError>;
  markers?: Record<string, string>;
  rows?: ProjectedRow[];
}) {
  const upserts: string[] = [];
  const adoptCalls: { claim: IdentityClaim | undefined; path: string }[] = [];
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
    async adopt(relativePath, claim) {
      adoptCalls.push({ claim, path: relativePath });
      if (claim) {
        const claimed = entry(relativePath, claim.kind);
        claimed.metadata.id = claim.id;
        return {
          attribution: {
            fromRelativePath: null,
            ownerId: claim.ownerId,
            via: "projection" as const,
          },
          entry: claimed,
        };
      }
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
    async findSubtreeByPath(relativePath: string) {
      const prefix = `${relativePath}/`;
      return (options.rows ?? []).filter(
        (row) =>
          row.relativePath === relativePath ||
          row.relativePath.startsWith(prefix),
      );
    },
    async recentRowAtPath(relativePath: string) {
      return options.claims?.[relativePath] ?? null;
    },
    async upsertFile(value: NamespaceEntry) {
      upserts.push(`file:${value.relativePath}`);
    },
    async upsertFolder(value: NamespaceEntry) {
      upserts.push(`folder:${value.relativePath}`);
    },
  } as unknown as ProjectionRepository;

  return {
    adoptCalls,
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

  it("removes the projected subtree when a populated folder is absent", async () => {
    const context = harness({
      rows: [
        { id: "folder-mutts", kind: "folder", relativePath: "MUTTS/mutts.pt" },
        {
          id: "folder-modules",
          kind: "folder",
          relativePath: "MUTTS/mutts.pt/node_modules",
        },
        {
          id: "file-pagination",
          kind: "file",
          relativePath:
            "MUTTS/mutts.pt/node_modules/@nextui-org/use-pagination/dist/index.mjs",
        },
        { id: "file-other", kind: "file", relativePath: "MUTTS/keep.txt" },
      ],
    });

    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["MUTTS/mutts.pt"],
    );

    expect(outcome.removed).toBe(3);
    expect(context.reaped?.reap.map((row) => row.id).sort()).toEqual([
      "file-pagination",
      "folder-modules",
      "folder-mutts",
    ]);
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

  it("adopts an unstamped entry under a fresh id when nothing claims it", async () => {
    const context = harness({
      adoptions: { "a/dropped.txt": entry("a/dropped.txt", "file") },
      failures: {
        "a/dropped.txt": new MetadataClientError("unstamped", "NO_IDENTITY"),
      },
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/dropped.txt"],
    );
    expect(outcome.adopted).toBe(1);
    expect(context.adoptCalls).toEqual([
      { claim: undefined, path: "a/dropped.txt" },
    ]);
    expect(context.upserts).toEqual(["file:a/dropped.txt"]);
  });

  it("adopts under the id a just-inserted row already holds for the path", async () => {
    // The row the API returned to its client seconds ago. Minting over it
    // would displace that row and the client's id would stop resolving.
    const claim: IdentityClaim = {
      createdAt: new Date(),
      id: "row-the-api-returned",
      kind: "folder",
      ownerId: "owner",
    };
    const context = harness({
      claims: { "a/new-folder": claim },
      failures: {
        "a/new-folder": new MetadataClientError("unstamped", "NO_IDENTITY"),
      },
    });
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/new-folder"],
    );
    expect(outcome.adopted).toBe(1);
    expect(context.adoptCalls).toEqual([{ claim, path: "a/new-folder" }]);
    expect(context.upserts).toEqual(["folder:a/new-folder"]);
  });

  it("falls back to a fresh id when the claim lookup itself fails", async () => {
    const context = harness({
      adoptions: { "a/dropped.txt": entry("a/dropped.txt", "file") },
      failures: {
        "a/dropped.txt": new MetadataClientError("unstamped", "NO_IDENTITY"),
      },
    });
    context.repository.recentRowAtPath = async () => {
      throw new Error("database away");
    };
    const outcome = await applyWatchedPaths(
      context.source,
      context.repository,
      ["a/dropped.txt"],
    );
    expect(outcome.adopted).toBe(1);
    expect(context.adoptCalls[0]?.claim).toBeUndefined();
  });
});
