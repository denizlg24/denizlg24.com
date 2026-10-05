import { normalizeBarcode } from "@repo/macros-core/barcode";
import { nutrientKeys } from "../../db/nutrients";
import type {
  NewItem,
  NewNutritionData,
  NutritionData,
  SupportedLanguage,
} from "../../db/schema";
import { ApiError } from "../../shared/errors";
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

const DEFAULT_MIN_SEARCH_SCORE = 0.1;

const normalizeNutrition = (
  input: NutritionPayload,
): Omit<NewNutritionData, "itemId"> => {
  const nutrients = Object.fromEntries(
    nutrientKeys.map((key) => [key, input[key] ?? null]),
  );

  return {
    servingLabel: input.servingLabel,
    servingQnty: input.servingQuantity,
    servingUnit: input.servingUnit,
    ...nutrients,
  };
};

// Denormalized projection used by search results. nutrition_data keeps the
// null, so an unmeasured macro reads as 0 here and as "unknown" there.
const deriveItemNutritionSummary = (
  input: NutritionPayload,
): ItemSummaryInput => ({
  servingLabel: input.servingLabel,
  caloriesPerServing: input.calories ?? 0,
  proteinPerServing: input.protein ?? 0,
  carbsPerServing: input.carbs ?? 0,
  fatPerServing: input.fat ?? 0,
});

const normalizeItem = (input: CreateItemInput): NewItem => ({
  barcode: normalizeBarcode(input.barcode),
  source: "user",
  name: input.name,
  brand: input.brand ?? null,
  ...(input.iconKey ? { iconKey: input.iconKey } : {}),
  ...deriveItemNutritionSummary(input.nutrition),
});

const normalizeItemUpdate = (input: UpdateItemInput): Partial<NewItem> => {
  const update: Partial<NewItem> = {};

  if (input.barcode !== undefined)
    update.barcode = normalizeBarcode(input.barcode);
  if (input.name !== undefined) update.name = input.name;
  if (input.brand !== undefined) update.brand = input.brand;
  if (input.iconKey !== undefined) update.iconKey = input.iconKey;

  return update;
};

const isEmptyObject = (value: Record<string, unknown>) =>
  Object.values(value).every((entry) => entry === undefined);

/** Resolves a barcode the catalog lacks from an upstream database. */
export interface BarcodeFallback {
  resolve(barcode: string): Promise<string | undefined>;
}

export interface ItemIndexer {
  index(itemIds: string[]): Promise<void>;
}

export interface ItemSearchCache {
  read<T>(params: unknown, load: () => Promise<T>): Promise<T>;
}

export class ItemsService {
  constructor(
    private readonly repository: ItemsRepositoryPort,
    private readonly fallback?: BarcodeFallback,
    private readonly indexer?: ItemIndexer,
    private readonly searchCache?: ItemSearchCache,
  ) {}

  /** Search is a projection; a failed push is repaired by the next sync. */
  private async reindex(itemId: string | undefined) {
    if (!itemId || !this.indexer) return;
    await this.indexer.index([itemId]).catch(() => undefined);
  }

  async search(
    input: ItemSearchInput,
    language: SupportedLanguage = "english",
    limit?: number,
    minScore = DEFAULT_MIN_SEARCH_SCORE,
  ) {
    if (!input.query?.trim() && !input.brand?.trim()) {
      throw new ApiError(400, "SEARCH_QUERY_REQUIRED", "Provide q or brand");
    }

    const load = () => this.repository.search(input, language, limit, minScore);
    if (!this.searchCache) return load();
    return this.searchCache.read(
      {
        query: input.query?.trim().toLocaleLowerCase(),
        brand: input.brand?.trim().toLocaleLowerCase(),
        language,
        limit,
        minScore,
      },
      load,
    );
  }

  async getById(id: string) {
    const item = await this.repository.findById(id);

    if (!item) {
      throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
    }

    return item;
  }

  async getByBarcode(barcode: string) {
    const item = await this.repository.findByBarcode(barcode);
    if (item) return item;

    const fetchedId = await this.fallback
      ?.resolve(barcode)
      .catch(() => undefined);
    const fetched = fetchedId
      ? await this.repository.findById(fetchedId)
      : undefined;
    if (fetched) return fetched;

    throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
  }

  async getPortions(id: string) {
    await this.getById(id);
    return this.repository.findPortions(id);
  }

  async getNutrition(id: string) {
    await this.getById(id);
    const nutrition = await this.repository.findNutritionByItemId(id);

    if (!nutrition) {
      throw new ApiError(
        404,
        "NUTRITION_NOT_FOUND",
        "Nutrition data not found",
      );
    }

    return nutrition;
  }

  async create(input: CreateItemInput) {
    const existing = await this.repository.findByBarcode(input.barcode);

    if (existing) {
      throw new ApiError(
        409,
        "BARCODE_ALREADY_EXISTS",
        "An item with this barcode already exists",
      );
    }

    const created = await this.repository.create(
      normalizeItem(input),
      normalizeNutrition(input.nutrition),
    );
    await this.reindex(created.item.id);
    return created;
  }

  async update(id: string, input: UpdateItemInput) {
    const normalized = normalizeItemUpdate(input);

    if (isEmptyObject(normalized)) {
      throw new ApiError(400, "EMPTY_UPDATE", "No item fields were provided");
    }

    const updated = await this.repository.updateItem(id, normalized);

    if (!updated) {
      throw new ApiError(404, "ITEM_NOT_FOUND", "Item not found");
    }

    await this.reindex(updated.id);
    return updated;
  }

  async updateNutrition(id: string, input: NutritionPayload) {
    await this.getById(id);
    const result = await this.repository.upsertNutrition(
      id,
      normalizeNutrition(input),
      deriveItemNutritionSummary(input),
    );
    await this.reindex(id);
    return result;
  }
}

export interface ItemsRepositoryPort {
  search(
    input: ItemSearchInput,
    language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]>;
  findById(id: string): Promise<ItemSummary | undefined>;
  findByBarcode(barcode: string): Promise<ItemSummary | undefined>;
  findPortions(itemId: string): Promise<{ label: string; grams: number }[]>;
  findNutritionByItemId(itemId: string): Promise<NutritionData | undefined>;
  create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ): Promise<{ item: ItemSummary }>;
  updateItem(
    id: string,
    input: Partial<NewItem>,
  ): Promise<ItemSummary | undefined>;
  upsertNutrition(
    itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ): Promise<unknown>;
}
