import { env } from "../config/env";
import { ApiError, toError } from "../shared/errors";

export interface MeilisearchSearchOptions {
  q: string;
  limit?: number;
  attributesToRetrieve?: string[];
  showRankingScore?: boolean;
}

export interface MeilisearchSearchResponse<THit> {
  hits: THit[];
}

export interface MeilisearchSearchClient {
  search<THit>(
    options: MeilisearchSearchOptions,
  ): Promise<MeilisearchSearchResponse<THit>>;
  /** Queues an upsert; Meilisearch indexes asynchronously. */
  addDocuments(documents: object[]): Promise<void>;
  deleteDocuments(ids: string[]): Promise<void>;
}

export class MeilisearchClient implements MeilisearchSearchClient {
  private readonly indexSearchUrl: string;
  private readonly indexDocumentsUrl: string;
  private readonly indexDeleteUrl: string;

  constructor(
    host: string,
    private readonly apiKey: string,
    index: string,
    private readonly timeoutMs: number,
  ) {
    const normalizedHost = host.replace(/\/+$/, "");
    const indexUrl = `${normalizedHost}/indexes/${encodeURIComponent(index)}`;
    this.indexSearchUrl = `${indexUrl}/search`;
    this.indexDocumentsUrl = `${indexUrl}/documents?primaryKey=id`;
    this.indexDeleteUrl = `${indexUrl}/documents/delete-batch`;
  }

  async deleteDocuments(ids: string[]) {
    if (ids.length === 0) return;
    const response = await fetch(this.indexDeleteUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(ids),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new ApiError(
        502,
        "SEARCH_PROVIDER_FAILED",
        "Search provider rejected a delete",
        { status: response.status, body: await response.text() },
      );
    }
  }

  async addDocuments(documents: object[]) {
    if (documents.length === 0) return;
    const response = await fetch(this.indexDocumentsUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(documents),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) {
      throw new ApiError(
        502,
        "SEARCH_PROVIDER_FAILED",
        "Search provider rejected documents",
        {
          status: response.status,
          body: await response.text(),
        },
      );
    }
  }

  async search<THit>(
    options: MeilisearchSearchOptions,
  ): Promise<MeilisearchSearchResponse<THit>> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.indexSearchUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(options),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ApiError(
          502,
          "SEARCH_PROVIDER_FAILED",
          "Search provider request failed",
          { status: response.status, body: await response.text() },
        );
      }

      return (await response.json()) as MeilisearchSearchResponse<THit>;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(
        502,
        "SEARCH_PROVIDER_FAILED",
        "Search provider request failed",
        toError(error).message,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const meilisearch = new MeilisearchClient(
  env.meilisearchHost,
  env.meilisearchApiKey,
  env.meilisearchIndex,
  env.meilisearchTimeoutMs,
);
