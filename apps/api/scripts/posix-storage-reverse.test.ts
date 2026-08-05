import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-storage-reverse.sh",
);
const roots: string[] = [];
const snapshotId = "posix-gate0-20260805T124412Z";
const ssdBranchId = "10000000-0000-4000-8000-000000000001";
const hddBranchId = "20000000-0000-4000-8000-000000000002";
const ownerId = "30000000-0000-4000-8000-000000000003";
const sharedFolderId = "40000000-0000-4000-8000-000000000004";
const accountFolderId = "40000000-0000-4000-8000-000000000005";
const ssdFileId = "50000000-0000-4000-8000-000000000006";
const hddFileId = "50000000-0000-4000-8000-000000000007";
const checksum = "a".repeat(64);

type Xattrs = Record<string, Record<string, string>>;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

/** True where `stat -c` works, i.e. GNU coreutils rather than BSD. */
function hasGnuStat(): boolean {
  const probe = Bun.spawnSync({
    cmd: ["stat", "-c", "%s", script],
    stderr: "pipe",
    stdout: "pipe",
  });
  return probe.exitCode === 0;
}

/**
 * The fixture keeps xattrs in a JSON map rather than on the filesystem, so
 * `getfattr` is always shimmed — including on Linux, where the real one would
 * correctly report that these files carry no xattrs.
 *
 * `stat` is shimmed only on BSD userlands. Translating `-c` to `-f` is right on
 * macOS and actively wrong on Linux, where GNU `stat -f` means "show filesystem
 * status", so shimming unconditionally would break CI.
 */
async function installShims(root: string, xattrDb: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin);
  const getfattr = join(bin, "getfattr");
  await writeFile(
    getfattr,
    `#!/usr/bin/env bash
key=""; path=""
while (($#)); do
  case "$1" in
    --only-values) shift ;;
    -n) key="$2"; shift 2 ;;
    --) path="$2"; shift 2 ;;
    *) path="$1"; shift ;;
  esac
done
value=$(jq -r --arg p "$path" --arg k "$key" '.[$p][$k] // empty' "${xattrDb}")
[[ -n "$value" ]] || exit 1
printf '%s' "$value"
`,
  );
  await chmod(getfattr, 0o755);

  if (!hasGnuStat()) {
    const stat = join(bin, "stat");
    await writeFile(
      stat,
      `#!/usr/bin/env bash
if [[ "$1" == "-c" ]]; then
  format="$2"; shift 2
  case "$format" in
    '%s') exec /usr/bin/stat -f '%z' "$@" ;;
    '%b') exec /usr/bin/stat -f '%b' "$@" ;;
    *) echo "unsupported stat format: $format" >&2; exit 1 ;;
  esac
fi
exec /usr/bin/stat "$@"
`,
    );
    await chmod(stat, 0o755);
  }
  return bin;
}

interface Fixture {
  root: string;
  sourceSsd: string;
  sourceHdd: string;
  targetSsd: string;
  targetHdd: string;
  journal: string;
  manifest: string;
  bin: string;
  xattrDb: string;
}

function branchMarker(role: "ssd" | "hdd", branchId: string): string {
  return `${JSON.stringify({
    schemaVersion: 1,
    role,
    filesystemUuid: `test-${role}-uuid`,
    branchId,
    createdAt: "2026-08-05T12:44:12Z",
  })}\n`;
}

async function fixture(mutate?: (xattrs: Xattrs) => void): Promise<Fixture> {
  // The script realpaths every root, and macOS resolves /var to /private/var.
  // The xattr shim is keyed by absolute path, so the fixture must agree.
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "posix-storage-reverse-")),
  );
  roots.push(root);
  const sourceSsd = join(root, "namespace-ssd");
  const sourceHdd = join(root, "namespace-hdd");
  const targetSsd = join(root, "legacy-ssd");
  const targetHdd = join(root, "legacy-hdd");
  const xattrDb = join(root, "xattrs.json");

  await Promise.all([
    mkdir(join(sourceSsd, "shared"), { recursive: true }),
    mkdir(join(sourceSsd, ownerId), { recursive: true }),
    // The HDD branch carries a scaffolding clone of `shared` with no identity
    // of its own, exactly as mergerfs creates it when placing a child there.
    mkdir(join(sourceHdd, "shared"), { recursive: true }),
    mkdir(targetSsd),
    mkdir(targetHdd),
  ]);
  await Promise.all([
    writeFile(
      join(sourceSsd, ".denizcloud-branch.json"),
      branchMarker("ssd", ssdBranchId),
    ),
    writeFile(
      join(sourceHdd, ".denizcloud-branch.json"),
      branchMarker("hdd", hddBranchId),
    ),
    writeFile(join(sourceSsd, "shared", "notes.txt"), "ssd-bytes"),
    writeFile(join(sourceHdd, "shared", "archive.bin"), "hdd-bytes"),
  ]);

  const xattrs: Xattrs = {
    [join(sourceSsd, "shared")]: {
      "user.denizcloud.id": sharedFolderId,
      "user.denizcloud.created_at": "2026-07-01T10:00:00Z",
      "user.denizcloud.schema_version": "1",
      "user.denizcloud.scope": "shared",
    },
    [join(sourceSsd, ownerId)]: {
      "user.denizcloud.id": accountFolderId,
      "user.denizcloud.created_at": "2026-07-01T10:00:00Z",
      "user.denizcloud.schema_version": "1",
      "user.denizcloud.owner_id": ownerId,
    },
    [join(sourceSsd, "shared", "notes.txt")]: {
      "user.denizcloud.id": ssdFileId,
      "user.denizcloud.created_at": "2026-07-02T10:00:00Z",
      "user.denizcloud.schema_version": "1",
      "user.denizcloud.owner_id": ownerId,
      "user.denizcloud.mime_type": "text/plain",
      "user.denizcloud.checksum": checksum,
      "user.denizcloud.checksum_state": "verified",
    },
    [join(sourceHdd, "shared", "archive.bin")]: {
      "user.denizcloud.id": hddFileId,
      "user.denizcloud.created_at": "2026-07-03T10:00:00Z",
      "user.denizcloud.schema_version": "1",
      "user.denizcloud.owner_id": ownerId,
      "user.denizcloud.checksum": checksum,
      "user.denizcloud.checksum_state": "verified",
    },
  };
  mutate?.(xattrs);
  await writeFile(xattrDb, JSON.stringify(xattrs));
  const bin = await installShims(root, xattrDb);

  return {
    root,
    sourceSsd,
    sourceHdd,
    targetSsd,
    targetHdd,
    journal: join(root, "reverse.journal.jsonl"),
    manifest: join(root, "reverse-manifest.jsonl"),
    bin,
    xattrDb,
  };
}

function run(
  data: Fixture,
  args: string[] = ["--manifest"],
  env: Record<string, string> = {},
) {
  const resolved = args.includes("--manifest")
    ? args.flatMap((arg) =>
        arg === "--manifest" ? [arg, data.manifest] : [arg],
      )
    : args;
  return Bun.spawnSync({
    cmd: ["bash", script, ...resolved, "--snapshot-id", snapshotId],
    env: {
      ...process.env,
      PATH: `${data.bin}:${process.env.PATH}`,
      POSIX_REVERSE_SOURCE_SSD: data.sourceSsd,
      POSIX_REVERSE_SOURCE_HDD: data.sourceHdd,
      POSIX_REVERSE_TARGET_SSD: data.targetSsd,
      POSIX_REVERSE_TARGET_HDD: data.targetHdd,
      POSIX_REVERSE_JOURNAL: data.journal,
      POSIX_REVERSE_SSD_UUID: "test-ssd-uuid",
      POSIX_REVERSE_HDD_UUID: "test-hdd-uuid",
      POSIX_REVERSE_SSD_BRANCH_ID: ssdBranchId,
      POSIX_REVERSE_HDD_BRANCH_ID: hddBranchId,
      POSIX_REVERSE_CURRENT_SNAPSHOT_ID: snapshotId,
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** Fails the test loudly if the fixture stops describing the entry it edits. */
function entryXattrs(xattrs: Xattrs, path: string): Record<string, string> {
  const entry = xattrs[path];
  if (!entry) throw new Error(`Fixture has no xattrs for ${path}`);
  return entry;
}

async function manifestRecords(path: string) {
  return (await readFile(path, "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

describe("POSIX namespace reverse exporter", () => {
  it("has valid shell syntax", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  it("reconstructs the legacy layout plan without touching the namespace", async () => {
    const data = await fixture();
    const result = run(data);

    expect(result.stderr.toString()).toBe("");
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      schemaVersion: 1,
      mode: "--dry-run",
      state: "planned",
      namespaceEntries: 4,
      namespaceFolders: 2,
      namespaceFiles: 2,
      namespaceMutated: false,
      sourceDeletionAllowed: false,
    });

    const records = await manifestRecords(data.manifest);
    expect(records[0]).toMatchObject({
      event: "reverse-summary",
      manifestSchema: "deniz-cloud-posix-reverse-v1",
      namespace: { folders: 2, files: 2 },
    });
    // Folders precede files, and each group is ordered so a consumer can
    // replay the manifest into the legacy layout top-down.
    expect(records.slice(1).map((record) => record.event)).toEqual([
      "reverse-folder",
      "reverse-folder",
      "reverse-file",
      "reverse-file",
    ]);
    expect(records.slice(1).map((record) => record.path)).toEqual([
      `/${ownerId}`,
      "/shared",
      "/shared/archive.bin",
      "/shared/notes.txt",
    ]);

    const shared = records.find((record) => record.path === "/shared");
    expect(shared).toMatchObject({
      id: sharedFolderId,
      ownerId: null,
      sourceTier: "ssd",
    });
    // The HDD file keeps its namespace path here; only the legacy destination
    // returns it to a flat UUID address.
    expect(
      records.find((record) => record.path === "/shared/archive.bin"),
    ).toMatchObject({
      id: hddFileId,
      sourceTier: "hdd",
      checksum,
      mimeType: null,
    });
    expect(
      records.find((record) => record.path === "/shared/notes.txt"),
    ).toMatchObject({
      id: ssdFileId,
      sourceTier: "ssd",
      mimeType: "text/plain",
    });

    for (const record of records.slice(1)) {
      expect(record.protectedXattrHash).toMatch(/^[0-9a-f]{64}$/);
    }
    // Distinct protected metadata must not collide into one hash.
    const hashes = records.slice(1).map((record) => record.protectedXattrHash);
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("stops on an entry that carries no identity on either branch", async () => {
    const data = await fixture();
    const parsed = JSON.parse(await readFile(data.xattrDb, "utf8")) as Xattrs;
    delete parsed[join(data.sourceSsd, ownerId)];
    await writeFile(data.xattrDb, JSON.stringify(parsed));

    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("No branch carries identity");
  });

  it("stops on a duplicate stable ID", async () => {
    const data = await fixture();
    const parsed = JSON.parse(await readFile(data.xattrDb, "utf8")) as Xattrs;
    entryXattrs(parsed, join(data.sourceHdd, "shared", "archive.bin"))[
      "user.denizcloud.id"
    ] = ssdFileId;
    await writeFile(data.xattrDb, JSON.stringify(parsed));

    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Duplicate stable ID");
  });

  it("refuses to export bytes the namespace has not verified", async () => {
    const data = await fixture();
    const parsed = JSON.parse(await readFile(data.xattrDb, "utf8")) as Xattrs;
    entryXattrs(parsed, join(data.sourceSsd, "shared", "notes.txt"))[
      "user.denizcloud.checksum_state"
    ] = "pending";
    await writeFile(data.xattrDb, JSON.stringify(parsed));

    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("not verified");
  });

  it("stops when the same file resolves on both branches", async () => {
    const data = await fixture();
    await writeFile(join(data.sourceSsd, "shared", "archive.bin"), "duplicate");

    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("resolves on both branches");
  });

  it("stops on an interrupted forward migration staging file", async () => {
    const data = await fixture();
    await writeFile(
      join(data.sourceSsd, "shared", `.${ssdFileId}.migration.partial`),
      "partial",
    );

    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Interrupted staging file");
  });

  it("keeps execute fail-closed outside the production allowlist", async () => {
    const data = await fixture();
    const result = run(data, ["--execute"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toMatch(
      /requires root|exact production storage path allowlist/,
    );
  });

  it("requires the operator-confirmed snapshot ID", async () => {
    const data = await fixture();
    const result = run(data, ["--manifest"], {
      POSIX_REVERSE_CURRENT_SNAPSHOT_ID: "posix-gate0-20260101T000000Z",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(
      "POSIX_REVERSE_CURRENT_SNAPSHOT_ID",
    );
  });
});
