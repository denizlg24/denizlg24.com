import { mkdir, readdir, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  THUMBNAIL_WIDTHS,
  type ThumbnailKind,
  type ThumbnailWidth,
} from "@repo/schemas/cloud";

export interface ThumbnailSource {
  id: string;
  kind: ThumbnailKind;
  /** Where this process can open the bytes: the broker mount in broker mode. */
  diskPath: string;
  sizeBytes: number;
  /** Part of the cache fingerprint, so a rewritten file gets a new thumbnail. */
  mtimeMs: number;
}

export interface SpawnResult {
  exitCode: number;
  stderr: string;
}

export interface ThumbnailServiceOptions {
  cacheRoot: string;
  /** Simultaneous generators. Two keeps a Pi responsive while a grid warms. */
  concurrency?: number;
  /** Requests waiting on a generator slot before the service answers "busy". */
  maxQueued?: number;
  timeoutMs?: number;
  /** A failed source is not retried for this long; a tile asks again on every scroll. */
  failureMemoryMs?: number;
  /** Overridable so the unit is testable without vips or ffmpeg. */
  spawn?: (command: string[], timeoutMs: number) => Promise<SpawnResult>;
}

export class ThumbnailBusyError extends Error {
  constructor() {
    super("Thumbnail generation is saturated");
    this.name = "ThumbnailBusyError";
  }
}

export function isThumbnailWidth(value: unknown): value is ThumbnailWidth {
  return (
    typeof value === "number" &&
    (THUMBNAIL_WIDTHS as readonly number[]).includes(value)
  );
}

async function runProcess(
  command: string[],
  timeoutMs: number,
): Promise<SpawnResult> {
  const child = Bun.spawn(command, { stderr: "pipe", stdout: "ignore" });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stderr };
  } finally {
    clearTimeout(timer);
  }
}

/** Seek point for the poster frame: 10 % in, or one second, whichever is earlier. */
export function posterSeekSeconds(durationSeconds: number | null): number {
  if (durationSeconds === null || !Number.isFinite(durationSeconds)) return 0;
  if (durationSeconds <= 0) return 0;
  return Math.min(1, durationSeconds * 0.1);
}

/**
 * Thumbnails as subprocesses, never as a native module.
 *
 * The storage doctrine is that file bytes never pass through JS and the API's
 * RSS stays flat: `vipsthumbnail` and `ffmpeg` read the source through the
 * same mount `Bun.file()` serves from and write the WebP straight to disk, and
 * whatever libvips allocates dies with the process instead of living on in a
 * heap that never shrinks. `sharp`'s prebuilt libvips also cannot decode the
 * HEVC-coded HEIC every iPhone produces; alpine's `vips-heif` can.
 *
 * The cache is derived data under `cacheRoot/<w>/<id[0..2]>/`, fingerprinted
 * by size and mtime so a rewritten file gets a new entry and the stale one is
 * unlinked. It is never backed up and is safe to `rm -rf`.
 */
export class ThumbnailService {
  readonly #root: string;
  readonly #concurrency: number;
  readonly #maxQueued: number;
  readonly #timeoutMs: number;
  readonly #failureMemoryMs: number;
  readonly #spawn: (
    command: string[],
    timeoutMs: number,
  ) => Promise<SpawnResult>;
  readonly #inflight = new Map<string, Promise<string | null>>();
  readonly #failed = new Map<string, number>();
  #active = 0;
  readonly #waiting: (() => void)[] = [];

  constructor(options: ThumbnailServiceOptions) {
    this.#root = options.cacheRoot;
    this.#concurrency = options.concurrency ?? 2;
    this.#maxQueued = options.maxQueued ?? 64;
    this.#timeoutMs = options.timeoutMs ?? 20_000;
    this.#failureMemoryMs = options.failureMemoryMs ?? 10 * 60 * 1_000;
    this.#spawn = options.spawn ?? runProcess;
  }

  get cacheRoot(): string {
    return this.#root;
  }

  /** Creates the cache root; resolves to the service so callers can chain. */
  async initialize(): Promise<this> {
    await mkdir(this.#root, { recursive: true });
    return this;
  }

  cachePath(source: ThumbnailSource, width: ThumbnailWidth): string {
    return join(
      this.#root,
      String(width),
      source.id.slice(0, 2),
      `${source.id}-${source.sizeBytes}-${Math.floor(source.mtimeMs)}.webp`,
    );
  }

  /** Whether a thumbnail is already on disk. Costs one stat, spawns nothing. */
  async exists(
    source: ThumbnailSource,
    width: ThumbnailWidth,
  ): Promise<boolean> {
    try {
      await stat(this.cachePath(source, width));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * The cached WebP's path, generating it on a miss. Null when the source
   * cannot be rendered — an unsupported codec, a corrupt file — which the
   * caller answers with the kind's glyph. Throws `ThumbnailBusyError` when
   * more requests are waiting than the queue allows, so a burst degrades to
   * a 503 with Retry-After rather than a pile of pending processes.
   */
  async get(
    source: ThumbnailSource,
    width: ThumbnailWidth,
  ): Promise<string | null> {
    const target = this.cachePath(source, width);
    if (await this.exists(source, width)) return target;
    const failedUntil = this.#failed.get(target);
    if (failedUntil !== undefined) {
      if (failedUntil > Date.now()) return null;
      this.#failed.delete(target);
    }
    // Forty tiles asking for the same image at once spawn one process.
    const pending = this.#inflight.get(target);
    if (pending) return pending;
    if (this.#inflight.size >= this.#concurrency + this.#maxQueued) {
      throw new ThumbnailBusyError();
    }
    const work = this.#withSlot(() => this.#generate(source, width, target))
      .then((ok) => {
        if (!ok) this.#failed.set(target, Date.now() + this.#failureMemoryMs);
        return ok ? target : null;
      })
      .finally(() => this.#inflight.delete(target));
    this.#inflight.set(target, work);
    return work;
  }

  /**
   * Removes cache entries whose file row is gone. `isLive` is asked once per
   * batch of ids so the nightly sweep is a few `IN` queries, not one per file.
   */
  async gc(
    isLive: (ids: string[]) => Promise<Set<string>>,
  ): Promise<{ scanned: number; removed: number }> {
    let scanned = 0;
    let removed = 0;
    for (const width of THUMBNAIL_WIDTHS) {
      const widthDir = join(this.#root, String(width));
      const shards = await readdir(widthDir).catch(() => [] as string[]);
      for (const shard of shards) {
        const shardDir = join(widthDir, shard);
        const entries = await readdir(shardDir).catch(() => [] as string[]);
        const byId = new Map<string, string[]>();
        for (const entry of entries) {
          const id = entry.slice(0, 36);
          if (!entry.endsWith(".webp") || id.length !== 36) continue;
          scanned += 1;
          byId.set(id, [...(byId.get(id) ?? []), entry]);
        }
        if (byId.size === 0) continue;
        const live = await isLive([...byId.keys()]);
        for (const [id, files] of byId) {
          if (live.has(id)) continue;
          for (const file of files) {
            await unlink(join(shardDir, file)).catch(() => undefined);
            removed += 1;
          }
        }
      }
    }
    return { removed, scanned };
  }

  async #withSlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.#active >= this.#concurrency) {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    this.#active += 1;
    try {
      return await work();
    } finally {
      this.#active -= 1;
      this.#waiting.shift()?.();
    }
  }

  async #generate(
    source: ThumbnailSource,
    width: ThumbnailWidth,
    target: string,
  ): Promise<boolean> {
    await mkdir(dirname(target), { recursive: true });
    const temp = `${target}.${crypto.randomUUID().slice(0, 8)}.tmp.webp`;
    const command =
      source.kind === "video"
        ? await this.#videoCommand(source, width, temp)
        : imageCommand(source, width, temp);
    let result: SpawnResult;
    try {
      result = await this.#spawn(command, this.#timeoutMs);
    } catch (error) {
      await unlink(temp).catch(() => undefined);
      console.warn(
        `Thumbnail generation could not start for ${source.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return false;
    }
    if (result.exitCode !== 0) {
      await unlink(temp).catch(() => undefined);
      console.warn(
        `Thumbnail generation failed for ${source.id} (${source.kind}, exit ${result.exitCode}): ${result.stderr.trim().slice(0, 300)}`,
      );
      return false;
    }
    try {
      await rename(temp, target);
    } catch {
      await unlink(temp).catch(() => undefined);
      return false;
    }
    await this.#unlinkStaleSiblings(target, source.id);
    return true;
  }

  async #videoCommand(
    source: ThumbnailSource,
    width: ThumbnailWidth,
    temp: string,
  ): Promise<string[]> {
    let duration: number | null = null;
    try {
      const child = Bun.spawn(
        [
          "ffprobe",
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "csv=p=0",
          source.diskPath,
        ],
        { stderr: "ignore", stdout: "pipe" },
      );
      const timer = setTimeout(() => child.kill(), 5_000);
      const text = (await new Response(child.stdout).text()).trim();
      clearTimeout(timer);
      duration = text ? Number.parseFloat(text) : null;
    } catch {
      duration = null;
    }
    // `-ss` before `-i` seeks without decoding the lead-in.
    return [
      "nice",
      "-n",
      "10",
      "ffmpeg",
      "-y",
      "-loglevel",
      "error",
      "-ss",
      posterSeekSeconds(duration).toFixed(2),
      "-i",
      source.diskPath,
      "-frames:v",
      "1",
      "-vf",
      `scale='min(${width},iw)':-2`,
      "-quality",
      "80",
      temp,
    ];
  }

  async #unlinkStaleSiblings(target: string, id: string): Promise<void> {
    const dir = dirname(target);
    const keep = target.slice(dir.length + 1);
    const entries = await readdir(dir).catch(() => [] as string[]);
    for (const entry of entries) {
      if (entry === keep || !entry.startsWith(`${id}-`)) continue;
      if (!entry.endsWith(".webp") || entry.includes(".tmp.")) continue;
      await unlink(join(dir, entry)).catch(() => undefined);
    }
  }
}

/**
 * `vipsthumbnail` for images and PDFs. It honours EXIF orientation by default,
 * loads only the first page of a PDF, and with `vips-heif` present decodes an
 * iPhone HEIC. The output is a WebP a little larger than the box so a tile
 * scaled by the browser stays crisp.
 */
function imageCommand(
  source: ThumbnailSource,
  width: ThumbnailWidth,
  temp: string,
): string[] {
  return [
    "nice",
    "-n",
    "10",
    "vipsthumbnail",
    source.diskPath,
    "--size",
    `${width}x${width}`,
    "-o",
    `${temp}[Q=80,strip]`,
  ];
}
