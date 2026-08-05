import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  protectedCanonicalForm,
  protectedMetadataHash,
} from "@repo/cloud-core";

import { runScript, ScriptError } from "./lib/runner";

const FORWARD_SCHEMA = "deniz-cloud-posix-migration-v1";
const REVERSE_SCHEMA = "deniz-cloud-posix-reverse-v1";

export interface ManifestEntry {
  checksum?: string;
  createdAt: string;
  event: string;
  id: string;
  mimeType?: string | null;
  ownerId: string | null;
  path: string;
  protectedXattrHash?: string;
  sizeBytes?: number;
  targetTier?: string;
  sourceTier?: string;
}

export interface ManifestDifference {
  code: string;
  detail: string;
  id: string | null;
  path: string;
}

/**
 * Rebuilds the exact string the reverse exporter hashes, from the values the
 * forward migration is going to write as xattrs. The canonical form itself
 * lives in cloud-core so the manifest verifier, the projector and the shell
 * exporters cannot drift apart.
 */
export function protectedCanonical(
  entry: ManifestEntry,
  kind: "file" | "folder",
): string {
  if (kind === "file" && !entry.checksum) {
    throw new ScriptError(`File entry has no checksum: ${entry.path}`);
  }
  return protectedCanonicalForm(entry, kind);
}

export function protectedHash(
  entry: ManifestEntry,
  kind: "file" | "folder",
): string {
  if (kind === "file" && !entry.checksum) {
    throw new ScriptError(`File entry has no checksum: ${entry.path}`);
  }
  return protectedMetadataHash(entry, kind);
}

function parseJsonl(
  contents: string,
  source: string,
): Record<string, unknown>[] {
  return contents
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        throw new ScriptError(`${source} line ${index + 1} is not valid JSON`);
      }
    });
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function assertManifestEntry(
  record: Record<string, unknown>,
  source: string,
  isFile: boolean,
): ManifestEntry {
  const where = typeof record.path === "string" ? record.path : "<no path>";
  const require = (condition: boolean, what: string) => {
    if (!condition) {
      throw new ScriptError(`${source} entry ${where} has ${what}`);
    }
  };
  require(typeof record.id === "string" && UUID.test(record.id), "no valid id");
  require(typeof record.path === "string" &&
    record.path.startsWith("/"), "no absolute path");
  require(typeof record.createdAt === "string", "no createdAt");
  require(record.ownerId === null ||
    (typeof record.ownerId === "string" &&
      UUID.test(record.ownerId)), "an invalid ownerId");
  if (isFile) {
    require(typeof record.checksum === "string" &&
      /^[0-9a-f]{64}$/i.test(record.checksum), "no valid checksum");
    require(typeof record.sizeBytes === "number" &&
      Number.isInteger(record.sizeBytes), "no integer sizeBytes");
  }
  return record as unknown as ManifestEntry;
}

export interface LoadedManifest {
  entries: Map<string, ManifestEntry>;
  files: number;
  folders: number;
  summary: Record<string, unknown>;
}

function loadManifest(
  records: Record<string, unknown>[],
  schema: string,
  summaryEvent: string,
  folderEvent: string,
  fileEvent: string,
  source: string,
): LoadedManifest {
  const summaries = records.filter((record) => record.event === summaryEvent);
  const [summary] = summaries;
  if (summaries.length !== 1 || !summary) {
    throw new ScriptError(
      `${source} must contain exactly one ${summaryEvent} record`,
    );
  }
  if (summary.manifestSchema !== schema) {
    throw new ScriptError(`${source} is not ${schema}`);
  }
  const entries = new Map<string, ManifestEntry>();
  let files = 0;
  let folders = 0;
  for (const record of records) {
    if (record.event !== folderEvent && record.event !== fileEvent) continue;
    // A manifest is operator-supplied evidence, so its shape is checked before
    // it is trusted. Casting an arbitrary record to ManifestEntry would let a
    // missing id or path compare as `undefined` against `undefined` and report
    // two mismatched manifests as identical.
    const entry = assertManifestEntry(
      record,
      source,
      record.event === fileEvent,
    );
    if (entries.has(entry.id)) {
      throw new ScriptError(`${source} repeats ID ${entry.id}`);
    }
    entries.set(entry.id, entry);
    if (record.event === fileEvent) files += 1;
    else folders += 1;
  }
  return { entries, files, folders, summary };
}

function kindOf(entry: ManifestEntry): "file" | "folder" {
  return entry.event.endsWith("-file") ? "file" : "folder";
}

export function compareManifests(
  forward: LoadedManifest,
  reverse: LoadedManifest,
): ManifestDifference[] {
  const differences: ManifestDifference[] = [];
  for (const [id, forwardEntry] of forward.entries) {
    const reverseEntry = reverse.entries.get(id);
    if (!reverseEntry) {
      differences.push({
        code: "MISSING_IN_REVERSE",
        detail: "the namespace no longer carries this stable ID",
        id,
        path: forwardEntry.path,
      });
      continue;
    }
    const kind = kindOf(forwardEntry);
    if (kind !== kindOf(reverseEntry)) {
      differences.push({
        code: "KIND_CHANGED",
        detail: `${kind} became ${kindOf(reverseEntry)}`,
        id,
        path: forwardEntry.path,
      });
      continue;
    }
    if (forwardEntry.path !== reverseEntry.path) {
      differences.push({
        code: "PATH_CHANGED",
        detail: `${forwardEntry.path} became ${reverseEntry.path}`,
        id,
        path: forwardEntry.path,
      });
    }
    if (forwardEntry.targetTier !== reverseEntry.sourceTier) {
      differences.push({
        code: "TIER_CHANGED",
        detail: `${forwardEntry.targetTier} became ${reverseEntry.sourceTier}`,
        id,
        path: forwardEntry.path,
      });
    }
    if (kind === "file") {
      if (forwardEntry.sizeBytes !== reverseEntry.sizeBytes) {
        differences.push({
          code: "SIZE_CHANGED",
          detail: `${forwardEntry.sizeBytes} became ${reverseEntry.sizeBytes}`,
          id,
          path: forwardEntry.path,
        });
      }
      if (
        forwardEntry.checksum?.toLowerCase() !==
        reverseEntry.checksum?.toLowerCase()
      ) {
        differences.push({
          code: "CHECKSUM_CHANGED",
          detail: "stored SHA-256 differs",
          id,
          path: forwardEntry.path,
        });
      }
    }
    const expected = protectedHash(forwardEntry, kind);
    if (reverseEntry.protectedXattrHash !== expected) {
      differences.push({
        code: "PROTECTED_METADATA_CHANGED",
        detail: `expected ${expected}, namespace has ${reverseEntry.protectedXattrHash ?? "none"}`,
        id,
        path: forwardEntry.path,
      });
    }
  }
  for (const [id, reverseEntry] of reverse.entries) {
    if (forward.entries.has(id)) continue;
    // Entries the namespace gained after cutover are the reason a reverse
    // migration exists, so they are reported rather than treated as drift.
    differences.push({
      code: "ADDED_AFTER_FORWARD",
      detail: "created in the namespace after the forward manifest was taken",
      id,
      path: reverseEntry.path,
    });
  }
  return differences;
}

export async function verifyManifests(options: {
  forwardPath: string;
  reversePath: string;
  requireExact: boolean;
}) {
  const [forwardRaw, reverseRaw] = await Promise.all([
    readFile(options.forwardPath, "utf8"),
    readFile(options.reversePath, "utf8"),
  ]);
  const forward = loadManifest(
    parseJsonl(forwardRaw, "forward manifest"),
    FORWARD_SCHEMA,
    "inventory-summary",
    "migration-folder",
    "migration-file",
    "forward manifest",
  );
  const reverse = loadManifest(
    parseJsonl(reverseRaw, "reverse manifest"),
    REVERSE_SCHEMA,
    "reverse-summary",
    "reverse-folder",
    "reverse-file",
    "reverse manifest",
  );

  const differences = compareManifests(forward, reverse);
  const added = differences.filter(
    (difference) => difference.code === "ADDED_AFTER_FORWARD",
  );
  const drift = differences.filter(
    (difference) => difference.code !== "ADDED_AFTER_FORWARD",
  );
  const exact = differences.length === 0;

  return {
    added: added.length,
    // Bounded so one broken rehearsal cannot bury the summary line.
    differences: differences.slice(0, 50),
    drift: drift.length,
    exact,
    forward: {
      files: forward.files,
      folders: forward.folders,
      path: resolve(options.forwardPath),
    },
    ok: options.requireExact ? exact : drift.length === 0,
    requireExact: options.requireExact,
    reverse: {
      files: reverse.files,
      folders: reverse.folders,
      path: resolve(options.reversePath),
    },
    truncatedDifferences: Math.max(0, differences.length - 50),
  };
}

if (import.meta.main) {
  await runScript("posix-manifest-verify", async (flags, log) => {
    if (!flags.dryRun) {
      throw new ScriptError(
        "posix-manifest-verify is read-only; --execute is not supported",
      );
    }
    const argv = process.argv.slice(2);
    const forwardIndex = argv.indexOf("--forward");
    const reverseIndex = argv.indexOf("--reverse");
    const forwardPath = argv[forwardIndex + 1];
    const reversePath = argv[reverseIndex + 1];
    if (
      forwardIndex === -1 ||
      reverseIndex === -1 ||
      !forwardPath ||
      forwardPath.startsWith("--") ||
      !reversePath ||
      reversePath.startsWith("--")
    ) {
      throw new ScriptError(
        "Usage: posix-manifest-verify.ts --forward PATH --reverse PATH [--allow-post-cutover-entries]",
      );
    }
    const result = await verifyManifests({
      forwardPath,
      requireExact: !argv.includes("--allow-post-cutover-entries"),
      reversePath,
    });
    await log.event("manifests-compared", {
      added: result.added,
      drift: result.drift,
      exact: result.exact,
    });
    if (!result.ok) {
      process.exitCode = 1;
    }
    return result;
  });
}
