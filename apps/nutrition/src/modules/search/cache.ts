import { logger } from "../../shared/logger";

export interface SearchCacheStore {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    seconds: number,
  ): Promise<unknown>;
  incr(key: string): Promise<number>;
}

const GENERATION_KEY = "nutrition:search:generation";
const TTL_SECONDS = 10 * 60;
// Meilisearch indexes asynchronously, so a search between the push and the
// task finishing caches the old answer under the new generation.
const SETTLE_MS = 3_000;

/**
 * Search answers keyed by the index generation: every index write bumps it,
 * which orphans every cached answer at once instead of scanning for them.
 * Writes that bypass the indexer (icon scripts editing Postgres) are covered
 * by the TTL. Redis failing never fails a search.
 */
export class SearchCache {
  constructor(private readonly store: SearchCacheStore) {}

  async read<T>(params: unknown, load: () => Promise<T>): Promise<T> {
    const generation = await this.store
      .get(GENERATION_KEY)
      .catch(() => undefined);
    if (generation === undefined) return load();
    const key = `nutrition:search:${generation ?? "0"}:${await digest(params)}`;
    const hit = await this.store.get(key).catch(() => null);
    if (hit !== null) {
      const cached: T = JSON.parse(hit);
      return cached;
    }

    const value = await load();
    await this.store
      .set(key, JSON.stringify(value), "EX", TTL_SECONDS)
      .catch((error) =>
        logger.warn("search cache write failed", { error: String(error) }),
      );
    return value;
  }

  /** False when Redis refused; cached answers then live out their TTL. */
  async invalidate(): Promise<boolean> {
    const bump = () =>
      this.store
        .incr(GENERATION_KEY)
        .then(() => true)
        .catch(() => false);
    setTimeout(() => void bump(), SETTLE_MS).unref();
    return bump();
  }
}

async function digest(params: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(params));
  const hash = await crypto.subtle.digest("SHA-1", bytes);
  return Buffer.from(hash).toString("hex");
}
