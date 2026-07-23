import { Meilisearch } from "meilisearch";

export { Meilisearch as MeiliSearch };

export function createMeiliClient(url: string, apiKey: string): Meilisearch {
  return new Meilisearch({
    host: url,
    apiKey,
  });
}
