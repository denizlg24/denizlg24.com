import { describe, expect, it } from "bun:test";

import type { Database } from "../../db/client";
import type {
  MeilisearchSearchClient,
  MeilisearchSearchOptions,
} from "../../infra/meilisearch";
import { ApiError } from "../../shared/errors";
import { ItemsRepository } from "./repository";

class FakeSearchClient implements MeilisearchSearchClient {
  options?: MeilisearchSearchOptions;
  hits: unknown[] = [];

  async search<THit>(options: MeilisearchSearchOptions) {
    this.options = options;
    return { hits: this.hits as THit[] };
  }

  async addDocuments() {}

  async deleteDocuments() {}
}

const database = {
  select: () => ({
    from: () => ({
      where: async () => [
        {
          id: "3df21ba2-94ef-44fc-aed6-3593bb9ca001",
          iconKey: "dairy-002",
        },
      ],
    }),
  }),
} as unknown as Database;

describe("ItemsRepository search", () => {
  it("queries Meilisearch and maps hits to item search results", async () => {
    const searchClient = new FakeSearchClient();
    searchClient.hits = [
      {
        id: "3df21ba2-94ef-44fc-aed6-3593bb9ca001",
        barcode: "0123456789",
        name: "Greek Yogurt",
        brand: "Deniz Foods",
        iconKey: "other-001",
        servingLabel: "100 g",
        caloriesPerServing: 59,
        proteinPerServing: 10,
        carbsPerServing: 3.6,
        fatPerServing: 0.4,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        _rankingScore: 0.83,
      },
      {
        id: "3df21ba2-94ef-44fc-aed6-3593bb9ca002",
        barcode: "9876543210",
        name: "Low Score Yogurt",
        brand: null,
        serving_label: "100 g",
        calories_per_serving: 70,
        protein_per_serving: 8,
        carbs_per_serving: 5,
        fat_per_serving: 1,
        created_at: 1_767_225_600,
        updated_at: 1_767_312_000_000,
        _rankingScore: 0.04,
      },
    ];
    const repository = new ItemsRepository(database, searchClient);

    const results = await repository.search(
      { query: "yogurt", brand: "Deniz" },
      "english",
      10,
      0.1,
    );

    expect(searchClient.options).toMatchObject({
      q: "yogurt Deniz",
      limit: 10,
      showRankingScore: true,
    });
    expect(results).toEqual([
      {
        id: "3df21ba2-94ef-44fc-aed6-3593bb9ca001",
        barcode: "0123456789",
        name: "Greek Yogurt",
        brand: "Deniz Foods",
        iconKey: "dairy-002",
        servingLabel: "100 g",
        caloriesPerServing: 59,
        proteinPerServing: 10,
        carbsPerServing: 3.6,
        fatPerServing: 0.4,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-02T00:00:00.000Z"),
        rank: 0.83,
        score: 0.83,
      },
    ]);
  });

  it("rejects invalid Meilisearch item payloads", async () => {
    const searchClient = new FakeSearchClient();
    searchClient.hits = [{ id: "missing-fields" }];
    const repository = new ItemsRepository(database, searchClient);

    const error = await repository
      .search({ query: "yogurt" }, "english", undefined, 0)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "SEARCH_PROVIDER_INVALID_RESPONSE",
      statusCode: 502,
    });
  });
});
