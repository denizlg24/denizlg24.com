import { afterEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const script = resolve(
  import.meta.dir,
  "../../../infra/scripts/posix-storage-tier.sh",
);
const roots: string[] = [];
const id = "50000000-0000-4000-8000-000000000006";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

const marker = `${JSON.stringify({
  branchId: "10000000-0000-4000-8000-000000000001",
  createdAt: "2026-08-05T12:44:12Z",
  filesystemUuid: "test-uuid",
  role: "ssd",
  schemaVersion: 1,
})}\n`;

/**
 * The fixture keeps identity in a JSON map rather than real xattrs, so
 * `getfattr` is shimmed. macOS has no attr(1) and no security.* namespace; the
 * script under test is unmodified and runs unchanged on the Pi.
 */
async function installGetfattrShim(root: string, db: string): Promise<string> {
  const bin = join(root, "bin");
  await mkdir(bin, { recursive: true });
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
value=$(jq -r --arg p "$path" --arg k "$key" '.[$p][$k] // empty' "${db}")
[[ -n "$value" ]] || exit 1
printf '%s' "$value"
`,
  );
  await chmod(getfattr, 0o755);
  return bin;
}

async function fixture(options: { withMarkers?: boolean } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "posix-tier-")));
  roots.push(root);
  const ssd = join(root, "ssd");
  const hdd = join(root, "hdd");
  await mkdir(join(ssd, "acct"), { recursive: true });
  await mkdir(hdd, { recursive: true });
  if (options.withMarkers !== false) {
    await writeFile(join(ssd, ".denizcloud-branch.json"), marker);
    await writeFile(join(hdd, ".denizcloud-branch.json"), marker);
  }
  await writeFile(join(ssd, "acct", "cold.bin"), "cold-bytes");
  const checksum = new Bun.CryptoHasher("sha256")
    .update("cold-bytes")
    .digest("hex");
  const plan = join(root, "plan.jsonl");
  await writeFile(
    plan,
    `${JSON.stringify({
      checksum,
      from: "ssd",
      id,
      relativePath: "acct/cold.bin",
      sizeBytes: 10,
      to: "hdd",
    })}\n`,
  );
  const xattrDb = join(root, "xattrs.json");
  await writeFile(
    xattrDb,
    JSON.stringify({
      [join(ssd, "acct", "cold.bin")]: { "security.denizcloud.id": id },
    }),
  );
  const bin = await installGetfattrShim(root, xattrDb);
  return { bin, checksum, hdd, plan, root, ssd };
}

function run(
  data: { ssd: string; hdd: string; plan: string; bin: string },
  args: string[] = [],
) {
  return Bun.spawnSync({
    cmd: ["bash", script, ...args, "--plan", data.plan],
    env: {
      ...process.env,
      PATH: `${data.bin}:${process.env.PATH}`,
      POSIX_TIER_HDD_BRANCH: data.hdd,
      POSIX_TIER_SSD_BRANCH: data.ssd,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
}

describe("POSIX same-path tier executor", () => {
  it("has valid shell syntax", () => {
    expect(Bun.spawnSync(["bash", "-n", script]).exitCode).toBe(0);
  });

  it("refuses a branch with no filesystem marker", async () => {
    const data = await fixture({ withMarkers: false });
    const result = run(data);
    expect(result.exitCode).not.toBe(0);
    // An unmounted branch is an empty directory; moving into one would write
    // to the root filesystem and report success.
    expect(result.stderr.toString()).toContain("Branch marker is missing");
  });

  it("rejects a plan entry that is not a safe same-path move", async () => {
    const data = await fixture();
    for (const entry of [
      { relativePath: "/absolute/path" },
      { relativePath: "acct/../escape" },
      { relativePath: "acct/._sidecar" },
      { from: "ssd", to: "ssd" },
      { checksum: "nothex" },
      { id: "not-a-uuid" },
    ]) {
      await writeFile(
        data.plan,
        `${JSON.stringify({
          checksum: data.checksum,
          from: "ssd",
          id,
          relativePath: "acct/cold.bin",
          sizeBytes: 10,
          to: "hdd",
          ...entry,
        })}\n`,
      );
      const result = run(data);
      expect(result.exitCode, JSON.stringify(entry)).not.toBe(0);
      expect(result.stderr.toString()).toContain("not a safe same-path");
    }
  });

  it("is dry-run by default and moves nothing", async () => {
    const data = await fixture();
    const result = run(data);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      eligible: 1,
      mode: "--dry-run",
      // A dry run that reported `moved` would read as though it had acted.
      moved: 0,
      planned: 1,
      quarantined: 0,
      sourceDeletedOnlyAfterVerifiedPublish: true,
    });
    expect(await Bun.file(join(data.ssd, "acct", "cold.bin")).text()).toBe(
      "cold-bytes",
    );
    expect(await Bun.file(join(data.hdd, "acct", "cold.bin")).exists()).toBe(
      false,
    );
  });

  it("quarantines rather than moving when the source checksum disagrees", async () => {
    const data = await fixture();
    await writeFile(join(data.ssd, "acct", "cold.bin"), "tampered");
    const result = run(data);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      moved: 0,
      quarantined: 1,
    });
  });

  it("leaves an existing destination for duplicate resolution", async () => {
    const data = await fixture();
    await mkdir(join(data.hdd, "acct"), { recursive: true });
    await writeFile(join(data.hdd, "acct", "cold.bin"), "already-here");
    const result = run(data);
    expect(JSON.parse(result.stdout.toString())).toMatchObject({
      moved: 0,
      quarantined: 1,
    });
    // Resolving needs the projection's tier hint, so the executor must not
    // pick a winner on its own.
    expect(result.stderr.toString()).toContain("duplicate resolution");
  });

  it("keeps execute fail-closed outside the production branch allowlist", async () => {
    const data = await fixture();
    const result = run(data, ["--execute"]);
    expect(result.exitCode).not.toBe(0);
    // Any of these is a legitimate closed door: on the Pi it stops at root or
    // the allowlist, on a dev machine at the missing GNU tooling.
    expect(result.stderr.toString()).toMatch(
      /requires root|exact production branch allowlist|Required execute command is missing/,
    );
    expect(await Bun.file(join(data.hdd, "acct", "cold.bin")).exists()).toBe(
      false,
    );
  });
});
