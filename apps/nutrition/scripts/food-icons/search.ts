import { createHash } from "node:crypto";
import { env } from "../../src/config/env";
import type { IconSearchHit } from "../../src/modules/food-icons/matching";

export interface IconSearchDocument {
  id: string;
  key: string;
  name: string;
  foodGroup: string;
  aliases: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class FoodIconSearch {
  readonly index = `${env.meilisearchIndex}_icons`;

  private async request(path: string, method: string, body?: unknown) {
    const response = await fetch(
      `${env.meilisearchHost.replace(/\/+$/, "")}${path}`,
      {
        method,
        headers: {
          authorization: `Bearer ${env.meilisearchApiKey}`,
          "content-type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const result: unknown = await response.json();
    if (!response.ok) {
      const code = isRecord(result) ? result.code : "unknown_error";
      if (path === "/indexes" && code === "index_already_exists") return;
      throw new Error(`Meilisearch ${response.status}: ${code}`);
    }
    return result;
  }

  private async wait(task: unknown, allowExisting = false) {
    if (!task) return;
    if (!isRecord(task) || typeof task.taskUid !== "number")
      throw new Error("Invalid Meilisearch task response");
    const taskUid = task.taskUid;
    for (let attempt = 0; attempt < 240; attempt++) {
      const result = await this.request(`/tasks/${taskUid}`, "GET");
      if (!isRecord(result) || typeof result.status !== "string")
        throw new Error("Invalid Meilisearch task status");
      if (result.status === "succeeded") return;
      if (
        allowExisting &&
        isRecord(result.error) &&
        result.error.code === "index_already_exists"
      )
        return;
      if (result.status === "failed" || result.status === "canceled")
        throw new Error(
          `Icon index task ${taskUid}: ${JSON.stringify(result.error)}`,
        );
      await Bun.sleep(250);
    }
    throw new Error(`Timed out waiting for icon index task ${taskUid}`);
  }

  async seed(documents: IconSearchDocument[]) {
    if (
      !documents.length ||
      documents.some((document) => !document.name.trim())
    )
      throw new Error("Icon names must be seeded before indexing");
    await this.wait(
      await this.request("/indexes", "POST", {
        uid: this.index,
        primaryKey: "id",
      }),
      true,
    );
    await this.wait(
      await this.request(`/indexes/${this.index}/settings`, "PATCH", {
        searchableAttributes: ["name", "aliases"],
        displayedAttributes: ["key", "name", "foodGroup", "aliases"],
        stopWords: [
          "a",
          "an",
          "the",
          "in",
          "of",
          "with",
          "and",
          "beside",
          "showing",
          "small",
          "two",
        ],
      }),
    );
    await this.wait(
      await this.request(`/indexes/${this.index}/documents`, "POST", documents),
    );
    return createHash("sha256").update(JSON.stringify(documents)).digest("hex");
  }

  async searchMany(queries: string[]) {
    if (!queries.length) return [];
    const response = await this.request("/multi-search", "POST", {
      queries: queries.map((q) => ({
        indexUid: this.index,
        q,
        limit: 5,
        matchingStrategy: "all",
        showRankingScore: true,
      })),
    });
    if (
      !isRecord(response) ||
      !Array.isArray(response.results) ||
      response.results.length !== queries.length
    )
      throw new Error("Meilisearch returned an incomplete icon search batch");
    return response.results.map((result: unknown): IconSearchHit[] => {
      if (!isRecord(result) || !Array.isArray(result.hits))
        throw new Error("Invalid icon search result");
      return result.hits.map((hit: unknown) => {
        if (
          !isRecord(hit) ||
          typeof hit.key !== "string" ||
          typeof hit.name !== "string" ||
          typeof hit._rankingScore !== "number"
        )
          throw new Error("Invalid icon search hit");
        return {
          key: hit.key,
          name: hit.name,
          aliases: Array.isArray(hit.aliases)
            ? hit.aliases.filter(
                (alias): alias is string => typeof alias === "string",
              )
            : [],
          _rankingScore: hit._rankingScore,
        };
      });
    });
  }
}
