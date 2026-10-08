import { describe, expect, it } from "bun:test";

import type {
  NewItem,
  NewNutritionData,
  NutritionData,
  SupportedLanguage,
} from "../../db/schema";
import type {
  ItemSearchInput,
  ItemSearchResult,
  ItemSummary,
  ItemSummaryInput,
} from "./repository";
import type {
  CreateItemInput,
  NutritionPayload,
  UpdateItemInput,
} from "./schemas";
import {
  type ItemIndexer,
  type ItemModeration,
  type ItemsRepositoryPort,
  ItemsService,
} from "./service";

const baseItem = {
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
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
} satisfies ItemSummary;

const nutritionPayload = {
  servingLabel: "100 g",
  servingQuantity: 100,
  servingUnit: "g",
  calories: 59,
  protein: 10,
  carbs: 3.6,
  fat: 0.4,
  sugar: 3.2,
} satisfies NutritionPayload;

class FakeItemsRepository implements ItemsRepositoryPort {
  existingByBarcode?: ItemSummary;
  existingById?: ItemSummary = baseItem;
  nutritionByItemId?: NutritionData;
  createdItem?: NewItem;
  createdNutrition?: Omit<NewNutritionData, "itemId">;
  updatedItem?: Partial<NewItem>;
  upsertedNutrition?: Omit<NewNutritionData, "itemId">;
  upsertedSummary?: ItemSummaryInput;
  searchArgs?: {
    input: ItemSearchInput;
    language: SupportedLanguage;
    limit: number | undefined;
    minScore: number;
  };
  searchResults: ItemSearchResult[] = [{ ...baseItem, rank: 0.75, score: 1.1 }];

  async search(
    input: ItemSearchInput,
    language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]> {
    this.searchArgs = { input, language, limit, minScore };
    return this.searchResults;
  }

  async findById(_id: string) {
    return this.existingById;
  }

  async findByBarcode(_barcode: string) {
    return this.existingByBarcode;
  }

  removedBarcode = false;
  moderation?: ItemModeration;

  async isBarcodeRemoved(_barcode: string) {
    return this.removedBarcode;
  }

  async findModeration(_id: string) {
    return this.moderation;
  }

  async setRemoved(id: string, removed: boolean, reason: string | null) {
    this.moderation = {
      id,
      source: "user",
      removedAt: removed ? new Date() : null,
      removedReason: removed ? reason : null,
    };
    return this.moderation;
  }

  async findPortions(_itemId: string) {
    return [];
  }

  async findNutritionByItemId(_itemId: string) {
    return this.nutritionByItemId;
  }

  async create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ) {
    this.createdItem = itemInput;
    this.createdNutrition = nutritionInput;

    return {
      item: baseItem,
      nutrition: nutritionInput,
    };
  }

  async updateItem(_id: string, input: Partial<NewItem>) {
    this.updatedItem = input;
    return this.existingById;
  }

  async upsertNutrition(
    _itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ) {
    this.upsertedNutrition = input;
    this.upsertedSummary = summary;

    return {
      item: baseItem,
      nutrition: input,
    };
  }
}

const createInput = {
  barcode: "0123456789",
  name: "Greek Yogurt",
  brand: "Deniz Foods",
  iconKey: "dairy-and-eggs-002",
  nutrition: nutritionPayload,
} satisfies CreateItemInput;

describe("ItemsService", () => {
  it("delegates search with default language and minimum score", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await expect(service.search({ query: "yogurt" })).resolves.toEqual([
      { ...baseItem, rank: 0.75, score: 1.1 },
    ]);
    expect(repository.searchArgs).toEqual({
      input: { query: "yogurt" },
      language: "english",
      limit: undefined,
      minScore: 0.1,
    });
  });

  it("delegates search limit and minimum score overrides", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await service.search(
      { query: "yogurt", brand: "Deniz" },
      "english",
      500,
      0.25,
    );

    expect(repository.searchArgs).toEqual({
      input: { query: "yogurt", brand: "Deniz" },
      language: "english",
      limit: 500,
      minScore: 0.25,
    });
  });

  it("delegates brand-only searches", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await service.search({ brand: "Deniz" });

    expect(repository.searchArgs).toEqual({
      input: { brand: "Deniz" },
      language: "english",
      limit: undefined,
      minScore: 0.1,
    });
  });

  it("rejects search without name or brand text", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await expect(service.search({})).rejects.toMatchObject({
      code: "SEARCH_QUERY_REQUIRED",
      statusCode: 400,
    });
    expect(repository.searchArgs).toBeUndefined();
  });

  it("looks up items by barcode", async () => {
    const repository = new FakeItemsRepository();
    repository.existingByBarcode = baseItem;
    const service = new ItemsService(repository);

    await expect(service.getByBarcode("0123456789")).resolves.toEqual(baseItem);

    repository.existingByBarcode = undefined;
    await expect(service.getByBarcode("unknown")).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("asks the fallback for a barcode the catalog lacks", async () => {
    const repository = new FakeItemsRepository();
    repository.existingByBarcode = undefined;
    const asked: string[] = [];
    const service = new ItemsService(repository, {
      resolve: async (barcode) => {
        asked.push(barcode);
        return baseItem.id;
      },
    });

    await expect(service.getByBarcode("5449000000996")).resolves.toEqual(
      baseItem,
    );
    expect(asked).toEqual(["5449000000996"]);
  });

  it("reports not found when the fallback has nothing either", async () => {
    const service = new ItemsService(new FakeItemsRepository(), {
      resolve: async () => undefined,
    });

    await expect(service.getByBarcode("5449000000996")).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
    });
  });

  it("creates an item with summary fields derived from nutrition", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await service.create(createInput);

    expect(repository.createdItem).toEqual({
      barcode: "00000123456789",
      source: "user",
      name: "Greek Yogurt",
      brand: "Deniz Foods",
      iconKey: "dairy-and-eggs-002",
      servingLabel: "100 g",
      caloriesPerServing: 59,
      proteinPerServing: 10,
      carbsPerServing: 3.6,
      fatPerServing: 0.4,
    });
    expect(repository.createdNutrition).toMatchObject({
      servingLabel: "100 g",
      servingQnty: 100,
      servingUnit: "g",
      calories: 59,
      protein: 10,
      carbs: 3.6,
      fat: 0.4,
      sugar: 3.2,
      // Nutrients the caller omitted stay null: not measured is not zero.
      water: null,
      sodium: null,
    });
  });

  it("blocks duplicate barcodes before creating", async () => {
    const repository = new FakeItemsRepository();
    repository.existingByBarcode = baseItem;
    const service = new ItemsService(repository);

    await expect(service.create(createInput)).rejects.toMatchObject({
      code: "BARCODE_ALREADY_EXISTS",
      statusCode: 409,
    });
    expect(repository.createdItem).toBeUndefined();
  });

  it("updates only mutable core item fields", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);
    const input = {
      name: "Updated Yogurt",
      brand: null,
      iconKey: "dairy-and-eggs-004",
    } satisfies UpdateItemInput;

    await service.update(baseItem.id, input);

    expect(repository.updatedItem).toEqual({
      name: "Updated Yogurt",
      brand: null,
      iconKey: "dairy-and-eggs-004",
    });
  });

  it("rejects empty item updates", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);

    await expect(service.update(baseItem.id, {})).rejects.toMatchObject({
      code: "EMPTY_UPDATE",
      statusCode: 400,
    });
  });

  it("rejects updates for missing items", async () => {
    const repository = new FakeItemsRepository();
    repository.existingById = undefined;
    const service = new ItemsService(repository);

    await expect(
      service.update(baseItem.id, { name: "Missing" }),
    ).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("refreshes item summary when nutrition is updated", async () => {
    const repository = new FakeItemsRepository();
    const service = new ItemsService(repository);
    const updatedNutrition = {
      ...nutritionPayload,
      servingLabel: "1 container",
      calories: 120,
      protein: 18,
      carbs: 8,
      fat: 2,
    } satisfies NutritionPayload;

    await service.updateNutrition(baseItem.id, updatedNutrition);

    expect(repository.upsertedSummary).toEqual({
      servingLabel: "1 container",
      caloriesPerServing: 120,
      proteinPerServing: 18,
      carbsPerServing: 8,
      fatPerServing: 2,
    });
    expect(repository.upsertedNutrition).toMatchObject({
      servingLabel: "1 container",
      calories: 120,
      protein: 18,
      carbs: 8,
      fat: 2,
    });
  });

  it("returns item and nutrition not-found errors", async () => {
    const repository = new FakeItemsRepository();
    repository.existingById = undefined;
    const service = new ItemsService(repository);

    await expect(service.getById(baseItem.id)).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
      statusCode: 404,
    });

    repository.existingById = baseItem;
    await expect(service.getNutrition(baseItem.id)).rejects.toMatchObject({
      code: "NUTRITION_NOT_FOUND",
      statusCode: 404,
    });
  });

  it("refuses a barcode a moderator took down, without the live fallback", async () => {
    const repository = new FakeItemsRepository();
    repository.removedBarcode = true;
    let fallbackCalled = false;
    const service = new ItemsService(repository, {
      resolve: async () => {
        fallbackCalled = true;
        return baseItem.id;
      },
    });

    await expect(service.getByBarcode("5601234567890")).rejects.toMatchObject({
      code: "ITEM_NOT_FOUND",
    });
    expect(fallbackCalled).toBe(false);
    await expect(
      service.create({
        barcode: "5601234567890",
        name: "Bar",
        nutrition: nutritionPayload,
      }),
    ).rejects.toMatchObject({ code: "BARCODE_REMOVED", statusCode: 409 });
  });

  it("drops a removed item from the index and re-adds a restored one", async () => {
    const repository = new FakeItemsRepository();
    const calls: string[] = [];
    const indexer: ItemIndexer = {
      index: async (ids) => {
        calls.push(`index:${ids.join()}`);
      },
      remove: async (ids) => {
        calls.push(`remove:${ids.join()}`);
      },
    };
    const service = new ItemsService(repository, undefined, indexer);

    const removed = await service.setRemoved(baseItem.id, true, "spam");
    expect(removed.removedReason).toBe("spam");
    await service.setRemoved(baseItem.id, false, "ignored");
    expect(repository.moderation?.removedReason).toBeNull();
    expect(calls).toEqual([`remove:${baseItem.id}`, `index:${baseItem.id}`]);
  });
});
