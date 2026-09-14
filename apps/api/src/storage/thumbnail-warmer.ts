import type { Database } from "@repo/cloud-core";
import { files } from "@repo/cloud-core/db/schema";
import type { StorageService } from "@repo/cloud-core/storage";
import { eq } from "drizzle-orm";

const WARM_QUEUE_KEY = "storage:thumbnails:warm";
const IDLE_POLL_MS = 2_000;
/** A queue that has grown past this is being fed faster than the Pi can draw; drop the oldest. */
const QUEUE_CAP = 20_000;

export interface WarmQueueRedis {
  rPush(key: string, value: string): Promise<number>;
  lPop(key: string): Promise<string | null>;
  lTrim(key: string, start: number, stop: number): Promise<unknown>;
}

/**
 * Pre-warms 256 px thumbnails for files the API just learned about.
 *
 * Upload finalize and the projector both push an id; one worker drains the
 * list at concurrency 1 so a folder of SMB-dropped photos is warm before
 * anyone opens it, without competing with the tiles a person is actually
 * looking at (the request path has its own two slots). Redis rather than an
 * in-memory queue so a restart mid-drop resumes instead of forgetting.
 */
export class ThumbnailWarmer {
  #stopped = false;
  #loop: Promise<void> | null = null;

  constructor(
    private readonly redis: WarmQueueRedis,
    private readonly db: Database,
    private readonly storage: StorageService,
  ) {}

  enqueue(fileId: string): void {
    void this.redis
      .rPush(WARM_QUEUE_KEY, fileId)
      .then((length) => {
        if (length > QUEUE_CAP) {
          return this.redis.lTrim(WARM_QUEUE_KEY, -QUEUE_CAP, -1);
        }
        return undefined;
      })
      .catch(() => undefined);
  }

  start(): void {
    if (this.#loop) return;
    this.#loop = this.#drain();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    await this.#loop;
  }

  async #drain(): Promise<void> {
    while (!this.#stopped) {
      let id: string | null = null;
      try {
        id = await this.redis.lPop(WARM_QUEUE_KEY);
      } catch {
        id = null;
      }
      if (!id) {
        await Bun.sleep(IDLE_POLL_MS);
        continue;
      }
      try {
        const [file] = await this.db
          .select()
          .from(files)
          .where(eq(files.id, id))
          .limit(1);
        // Deleted before its turn came: nothing to draw.
        if (file) await this.storage.warmThumbnail(file, 256);
      } catch (error) {
        console.warn(
          `Thumbnail warm failed for ${id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
