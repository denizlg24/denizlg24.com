import { barcodeLookupKeys } from "@repo/macros-core/barcode";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

import type { Database } from "../../db/client";
import {
  defaultFoodIconKey,
  type Item,
  itemBarcodes,
  itemPortions,
  items,
  type NewItem,
  type NewNutritionData,
  type NutritionData,
  nutritionData,
  type SupportedLanguage,
} from "../../db/schema";
import type { MeilisearchSearchClient } from "../../infra/meilisearch";
import { ApiError } from "../../shared/errors";

export type ItemSummary = Pick<
  Item,
  | "id"
  | "barcode"
  | "name"
  | "brand"
  | "iconKey"
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
  | "createdAt"
  | "updatedAt"
>;

export interface ItemSearchResult extends ItemSummary {
  rank: number;
  score: number;
}

export type ItemSummaryInput = Pick<
  NewItem,
  | "servingLabel"
  | "caloriesPerServing"
  | "proteinPerServing"
  | "carbsPerServing"
  | "fatPerServing"
>;

const itemSummarySelect = {
  id: items.id,
  barcode: items.barcode,
  name: items.name,
  brand: items.brand,
  iconKey: items.iconKey,
  servingLabel: items.servingLabel,
  caloriesPerServing: items.caloriesPerServing,
  proteinPerServing: items.proteinPerServing,
  carbsPerServing: items.carbsPerServing,
  fatPerServing: items.fatPerServing,
  createdAt: items.createdAt,
  updatedAt: items.updatedAt,
};

export interface ItemSearchInput {
  query?: string;
  brand?: string;
}

interface MeilisearchItemHit {
  [key: string]: unknown;
  _rankingScore?: number;
}

const searchableAttributes = [
  "id",
  "barcode",
  "name",
  "brand",
  "iconKey",
  "icon_key",
  "servingLabel",
  "serving_label",
  "caloriesPerServing",
  "calories_per_serving",
  "proteinPerServing",
  "protein_per_serving",
  "carbsPerServing",
  "carbs_per_serving",
  "fatPerServing",
  "fat_per_serving",
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
];

const readField = (
  hit: MeilisearchItemHit,
  camelName: string,
  snakeName = camelName,
) => hit[camelName] ?? hit[snakeName];

const readRequiredString = (
  hit: MeilisearchItemHit,
  camelName: string,
  snakeName?: string,
) => {
  const value = readField(hit, camelName, snakeName);

  if (typeof value !== "string") {
    throw new ApiError(
      502,
      "SEARCH_PROVIDER_INVALID_RESPONSE",
      "Search provider returned an invalid item payload",
      { field: camelName },
    );
  }

  return value;
};

const readNullableString = (
  hit: MeilisearchItemHit,
  camelName: string,
  snakeName?: string,
) => {
  const value = readField(hit, camelName, snakeName);

  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    throw new ApiError(
      502,
      "SEARCH_PROVIDER_INVALID_RESPONSE",
      "Search provider returned an invalid item payload",
      { field: camelName },
    );
  }

  return value;
};

const readRequiredNumber = (
  hit: MeilisearchItemHit,
  camelName: string,
  snakeName?: string,
) => {
  const value = readField(hit, camelName, snakeName);
  const numberValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numberValue)) {
    throw new ApiError(
      502,
      "SEARCH_PROVIDER_INVALID_RESPONSE",
      "Search provider returned an invalid item payload",
      { field: camelName },
    );
  }

  return numberValue;
};

const readRequiredDate = (
  hit: MeilisearchItemHit,
  camelName: string,
  snakeName?: string,
) => {
  const value = readField(hit, camelName, snakeName);
  const date =
    typeof value === "number"
      ? new Date(value < 10_000_000_000 ? value * 1_000 : value)
      : value instanceof Date
        ? value
        : new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    throw new ApiError(
      502,
      "SEARCH_PROVIDER_INVALID_RESPONSE",
      "Search provider returned an invalid item payload",
      { field: camelName },
    );
  }

  return date;
};

const toItemSearchResult = (hit: MeilisearchItemHit): ItemSearchResult => {
  const score =
    typeof hit._rankingScore === "number" && Number.isFinite(hit._rankingScore)
      ? hit._rankingScore
      : 1;

  return {
    id: readRequiredString(hit, "id"),
    barcode: readRequiredString(hit, "barcode"),
    name: readRequiredString(hit, "name"),
    brand: readNullableString(hit, "brand"),
    iconKey:
      readNullableString(hit, "iconKey", "icon_key") ?? defaultFoodIconKey,
    servingLabel: readRequiredString(hit, "servingLabel", "serving_label"),
    caloriesPerServing: readRequiredNumber(
      hit,
      "caloriesPerServing",
      "calories_per_serving",
    ),
    proteinPerServing: readRequiredNumber(
      hit,
      "proteinPerServing",
      "protein_per_serving",
    ),
    carbsPerServing: readRequiredNumber(
      hit,
      "carbsPerServing",
      "carbs_per_serving",
    ),
    fatPerServing: readRequiredNumber(hit, "fatPerServing", "fat_per_serving"),
    createdAt: readRequiredDate(hit, "createdAt", "created_at"),
    updatedAt: readRequiredDate(hit, "updatedAt", "updated_at"),
    rank: score,
    score,
  };
};

export class ItemsRepository {
  constructor(
    private readonly database: Database,
    private readonly searchClient: MeilisearchSearchClient,
  ) {}

  async search(
    input: ItemSearchInput,
    _language: SupportedLanguage,
    limit: number | undefined,
    minScore: number,
  ): Promise<ItemSearchResult[]> {
    const query = input.query?.trim();
    const brand = input.brand?.trim();
    const searchTerms = [query, brand].filter(Boolean).join(" ");
    const response = await this.searchClient.search<MeilisearchItemHit>({
      q: searchTerms,
      limit,
      attributesToRetrieve: searchableAttributes,
      showRankingScore: true,
    });

    const results = response.hits
      .map(toItemSearchResult)
      .filter((item) => item.score >= minScore);

    if (results.length === 0) return results;

    const iconRows = await this.database
      .select({
        id: items.id,
        iconKey: items.iconKey,
        removedAt: items.removedAt,
      })
      .from(items)
      .where(
        inArray(
          items.id,
          results.map((item) => item.id),
        ),
      );
    const iconKeysByItemId = new Map(
      iconRows.map((item) => [item.id, item.iconKey]),
    );

    // The index drops a removed row asynchronously; never serve it meanwhile.
    const removed = new Set(
      iconRows.filter((item) => item.removedAt).map((item) => item.id),
    );

    return results
      .filter((item) => !removed.has(item.id))
      .map((item) => ({
        ...item,
        iconKey: iconKeysByItemId.get(item.id) ?? item.iconKey,
      }));
  }

  async findById(id: string): Promise<ItemSummary | undefined> {
    const [item] = await this.database
      .select(itemSummarySelect)
      .from(items)
      .where(eq(items.id, id))
      .limit(1);

    return item;
  }

  /**
   * Resolves a scanned or typed code. Every plausible spelling is tried at
   * once (normalized GTIN-14, UPC-E expansion, a completed check digit, the
   * raw string for rows that predate normalization), the most likely
   * spelling wins, and a merged duplicate resolves to the row it was merged
   * into.
   */
  async findByBarcode(barcode: string): Promise<ItemSummary | undefined> {
    const keys = barcodeLookupKeys(barcode);

    const [aliased, direct] = await Promise.all([
      this.database
        .select({ barcode: itemBarcodes.barcode, itemId: itemBarcodes.itemId })
        .from(itemBarcodes)
        .where(inArray(itemBarcodes.barcode, keys)),
      this.database
        .select({ barcode: items.barcode, itemId: items.id })
        .from(items)
        .where(inArray(items.barcode, keys)),
    ]);

    const byKey = new Map<string, string>();
    for (const row of [...direct, ...aliased]) {
      if (!byKey.has(row.barcode)) byKey.set(row.barcode, row.itemId);
    }
    const itemId = keys.map((key) => byKey.get(key)).find(Boolean);
    if (!itemId) return undefined;

    return this.resolveMerged(itemId);
  }

  /** True when moderation took down the row a code resolves to. */
  async isBarcodeRemoved(barcode: string): Promise<boolean> {
    const keys = barcodeLookupKeys(barcode);
    const [row] = await this.database
      .select({ id: items.id })
      .from(items)
      .where(and(inArray(items.barcode, keys), isNotNull(items.removedAt)))
      .limit(1);
    return Boolean(row);
  }

  async findModeration(id: string) {
    const [row] = await this.database
      .select({
        id: items.id,
        source: items.source,
        removedAt: items.removedAt,
        removedReason: items.removedReason,
      })
      .from(items)
      .where(eq(items.id, id))
      .limit(1);
    return row;
  }

  async setRemoved(id: string, removed: boolean, reason: string | null) {
    const [row] = await this.database
      .update(items)
      .set({
        removedAt: removed ? new Date() : null,
        removedReason: removed ? reason : null,
        updatedAt: new Date(),
      })
      .where(eq(items.id, id))
      .returning({
        id: items.id,
        source: items.source,
        removedAt: items.removedAt,
        removedReason: items.removedReason,
      });
    return row;
  }

  /** Follows merged_into to the surviving row; bounded against cycles. */
  private async resolveMerged(
    itemId: string,
  ): Promise<ItemSummary | undefined> {
    let currentId = itemId;
    for (let hop = 0; hop < 4; hop += 1) {
      const [row] = await this.database
        .select({
          ...itemSummarySelect,
          mergedInto: items.mergedInto,
          removedAt: items.removedAt,
        })
        .from(items)
        .where(eq(items.id, currentId))
        .limit(1);
      if (!row || row.removedAt) return undefined;
      const { mergedInto, removedAt: _removedAt, ...summary } = row;
      if (!mergedInto || mergedInto === currentId) return summary;
      currentId = mergedInto;
    }
    return this.findById(currentId);
  }

  async findPortions(itemId: string) {
    return this.database
      .select({ label: itemPortions.label, grams: itemPortions.grams })
      .from(itemPortions)
      .where(eq(itemPortions.itemId, itemId))
      .orderBy(asc(itemPortions.sortOrder));
  }

  async findNutritionByItemId(
    itemId: string,
  ): Promise<NutritionData | undefined> {
    const [nutrition] = await this.database
      .select()
      .from(nutritionData)
      .where(eq(nutritionData.itemId, itemId))
      .limit(1);

    return nutrition;
  }

  async create(
    itemInput: NewItem,
    nutritionInput: Omit<NewNutritionData, "itemId">,
  ) {
    return this.database.transaction(async (transaction) => {
      const [createdItem] = await transaction
        .insert(items)
        .values(itemInput)
        .returning(itemSummarySelect);

      if (!createdItem) {
        throw new Error("Failed to create item");
      }

      await transaction
        .insert(itemBarcodes)
        .values({
          barcode: createdItem.barcode,
          itemId: createdItem.id,
          kind: "primary",
        })
        .onConflictDoNothing();

      const [createdNutrition] = await transaction
        .insert(nutritionData)
        .values({
          ...nutritionInput,
          itemId: createdItem.id,
        })
        .returning();

      return {
        item: createdItem,
        nutrition: createdNutrition,
      };
    });
  }

  async updateItem(
    id: string,
    input: Partial<NewItem>,
  ): Promise<ItemSummary | undefined> {
    const [item] = await this.database
      .update(items)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(items.id, id))
      .returning(itemSummarySelect);

    return item;
  }

  async upsertNutrition(
    itemId: string,
    input: Omit<NewNutritionData, "itemId">,
    summary: ItemSummaryInput,
  ): Promise<{ item: ItemSummary; nutrition: NutritionData }> {
    return this.database.transaction(async (transaction) => {
      const now = new Date();
      const [nutrition] = await transaction
        .insert(nutritionData)
        .values({
          ...input,
          itemId,
        })
        .onConflictDoUpdate({
          target: nutritionData.itemId,
          set: {
            ...input,
            updatedAt: now,
          },
        })
        .returning();

      if (!nutrition) {
        throw new Error("Failed to upsert nutrition data");
      }

      const [item] = await transaction
        .update(items)
        .set({
          ...summary,
          updatedAt: now,
        })
        .where(eq(items.id, itemId))
        .returning(itemSummarySelect);

      if (!item) {
        throw new Error("Failed to update item nutrition summary");
      }

      return {
        item,
        nutrition,
      };
    });
  }
}
