import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type ArchiveEntry, archiveByteLength } from "./archive";
import {
  ARCHIVE_JOB_SNAPSHOT_FILENAME,
  type ArchiveJob,
  ArchiveJobStore,
  readArchiveJobSnapshot,
} from "./archive-jobs";
import { pathExists } from "./fs";

const OWNER = "user:one";

/**
 * The snapshot is rejected unless its mode is exactly 0600. Windows has no
 * POSIX mode bits — `chmod` moves only the read-only flag and `stat` reports
 * 0666 regardless — so the invariant is unrepresentable there, not violated.
 * Production and CI are Linux, where these run for real.
 */
const POSIX_MODE_BITS = process.platform !== "win32";

async function settle(job: ArchiveJob): Promise<ArchiveJob> {
  const deadline = Date.now() + 5_000;
  while (job.state === "building" && Date.now() < deadline) {
    await Bun.sleep(10);
  }
  return job;
}

describe("archive job store", () => {
  let root: string | undefined;
  let opened: ArchiveJobStore | undefined;

  afterEach(async () => {
    opened?.close();
    opened = undefined;
    if (root) await rm(root, { recursive: true, force: true });
    root = undefined;
  });

  async function fixture(ttlMs = 60_000): Promise<{
    jobs: ArchiveJobStore;
    directory: string;
    entries: ArchiveEntry[];
    totalBytes: number;
  }> {
    root = await mkdtemp(join(tmpdir(), "cloud-archive-jobs-"));
    const source = join(root, "note.txt");
    await Bun.write(source, "archive me");
    const entries: ArchiveEntry[] = [
      {
        name: "note.txt",
        diskPath: source,
        size: 10,
        modifiedAt: new Date("2026-01-01T00:00:00Z"),
      },
    ];
    const directory = join(root, "archives");
    const jobs = new ArchiveJobStore({
      directory,
      ttlMs,
      sweepIntervalMs: 3_600_000,
    });
    await jobs.initialize();
    opened = jobs;
    return { jobs, directory, entries, totalBytes: archiveByteLength(entries) };
  }

  it("builds the archive and lands on the predicted size", async () => {
    const { jobs, entries, totalBytes } = await fixture();
    const job = await settle(
      await jobs.start({
        ownerKey: OWNER,
        filename: "f.zip",
        totalBytes,
        entries,
      }),
    );
    expect(job.state).toBe("ready");
    expect(job.writtenBytes).toBe(totalBytes);
    expect(await pathExists(job.diskPath)).toBe(true);
  });

  // A project credential is scoped to one project's tree; an archive built for
  // one must not be reachable through another's key.
  it("only hands a job back to the owner that started it", async () => {
    const { jobs, entries, totalBytes } = await fixture();
    const job = await jobs.start({
      ownerKey: OWNER,
      filename: "f.zip",
      totalBytes,
      entries,
    });
    await settle(job);
    expect(jobs.find(OWNER, job.id)).toBeDefined();
    expect(jobs.find("user:two", job.id)).toBeUndefined();
  });

  it("records the failure and drops the partial file", async () => {
    const { jobs, entries, totalBytes } = await fixture();
    const job = await settle(
      await jobs.start({
        ownerKey: OWNER,
        filename: "f.zip",
        totalBytes,
        entries: entries.map((entry) => ({ ...entry, size: entry.size + 5 })),
      }),
    );
    expect(job.state).toBe("failed");
    expect(job.error).toContain("Archive source size changed");
    expect(await pathExists(job.diskPath)).toBe(false);
  });

  it("sweeps expired jobs and files the registry lost track of", async () => {
    const { jobs, directory, entries, totalBytes } = await fixture(0);
    const job = await settle(
      await jobs.start({
        ownerKey: OWNER,
        filename: "f.zip",
        totalBytes,
        entries,
      }),
    );
    const orphan = join(directory, "orphan.zip");
    await Bun.write(orphan, "left behind by a restart");
    const stale = new Date(Date.now() - 60_000);
    await utimes(orphan, stale, stale);

    await jobs.sweep();

    expect(jobs.find(OWNER, job.id)).toBeUndefined();
    expect(await pathExists(job.diskPath)).toBe(false);
    expect(await pathExists(orphan)).toBe(false);
  });

  it.skipIf(!POSIX_MODE_BITS)(
    "publishes a private snapshot without user-visible archive details",
    async () => {
      const { jobs, directory, entries, totalBytes } = await fixture();
      const initial = await readArchiveJobSnapshot(directory);
      expect(initial).toMatchObject({
        snapshot: { activeJobs: [], pid: process.pid, version: 1 },
        status: "current",
      });

      const job = await jobs.start({
        ownerKey: OWNER,
        filename: "private-name.zip",
        totalBytes,
        entries,
      });
      const duringBuild = JSON.parse(
        await readFile(join(directory, ARCHIVE_JOB_SNAPSHOT_FILENAME), "utf8"),
      );
      expect(duringBuild.activeJobs).toEqual([
        expect.objectContaining({ id: job.id, state: "building" }),
      ]);
      expect(JSON.stringify(duringBuild)).not.toContain(OWNER);
      expect(JSON.stringify(duringBuild)).not.toContain("private-name.zip");
      expect(
        (await stat(join(directory, ARCHIVE_JOB_SNAPSHOT_FILENAME))).mode &
          0o777,
      ).toBe(0o600);

      await settle(job);
      expect(await readArchiveJobSnapshot(directory)).toMatchObject({
        snapshot: { activeJobs: [] },
        status: "current",
      });
    },
  );

  it.skipIf(!POSIX_MODE_BITS)(
    "distinguishes stale and unsafe snapshots from a current zero",
    async () => {
      const { directory } = await fixture();
      const path = join(directory, ARCHIVE_JOB_SNAPSHOT_FILENAME);
      const snapshot = JSON.parse(await readFile(path, "utf8"));
      snapshot.pid = 2_147_483_647;
      await Bun.write(path, `${JSON.stringify(snapshot)}\n`);
      await chmod(path, 0o600);
      expect(await readArchiveJobSnapshot(directory)).toMatchObject({
        status: "stale",
      });

      await chmod(path, 0o644);
      expect(await readArchiveJobSnapshot(directory)).toEqual({
        reason: "archive activity snapshot permissions are not private",
        status: "invalid",
      });
    },
  );
});
