import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const supportedLanguages = [
  "english",
  "portuguese",
  "spanish",
  "french",
] as const;

export type SupportedLanguage = (typeof supportedLanguages)[number];

export const defaultFoodIconKey = "other-001";

/** Food composition tables compiled from laboratory and literature data. */
export const researchSources = [
  "usda_foundation",
  "usda_sr_legacy",
  "usda_fndds",
  "cnf",
  "cofid",
  "ciqual",
  "insa",
  "frida",
  "bls",
  "matvaretabellen",
  "livsmedelsverket",
  "swiss_fcdb",
  "afcd",
] as const;

export const itemSources = [
  ...researchSources,
  "usda_branded",
  "openfoodfacts",
  "user",
  "unknown",
] as const;

export type ItemSource = (typeof itemSources)[number];

export const unknownSource = "unknown" satisfies ItemSource;

/** Per-nutrient record of which source supplied the stored value. */
export type NutrientProvenance = Record<string, ItemSource>;

// Nullable on purpose: null means "not measured by the source", which is a
// different fact from a measured zero. Never coerce one into the other.
const nutrient = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: "number" });

const requiredAmount = (name: string) =>
  numeric(name, { precision: 12, scale: 3, mode: "number" }).notNull();

export const foodIcons = pgTable(
  "food_icons",
  {
    key: text("key").primaryKey(),
    foodGroup: text("food_group").notNull(),
    mediaType: text("media_type").notNull().default("image/png"),
    imageBase64: text("image_base64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("food_icons_food_group_idx").on(table.foodGroup)],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    barcode: text("barcode").notNull(),
    name: text("name").notNull(),
    brand: text("brand"),
    iconKey: text("icon_key")
      .notNull()
      .default(defaultFoodIconKey)
      .references(() => foodIcons.key),
    source: text("source").notNull().default(unknownSource),
    sourceId: text("source_id"),
    ndbNumber: text("ndb_number"),
    qualityFlags: text("quality_flags")
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    quarantined: boolean("quarantined").notNull().default(false),
    /**
     * Taken down by moderation. Unlike `quarantined` (a data-quality verdict
     * an import makes), a removed row is gone from search and barcode lookup
     * alike, and its barcode cannot be contributed again; it stays readable by
     * id because Macros stores item ids.
     */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedReason: text("removed_reason"),
    /** English name for rows whose source names foods in another language. */
    nameEn: text("name_en"),
    /** ISO 3166-1 alpha-2 country a research table describes, lowercase. */
    region: text("region"),
    foodGroup: text("food_group"),
    /** Unique scans on OpenFoodFacts; ranks duplicates and search ties. */
    popularity: integer("popularity").notNull().default(0),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    /**
     * Set on a duplicate whose nutrition agrees with a better row. The
     * duplicate stays readable by id; barcode lookups resolve to the target and
     * search never sees it.
     */
    mergedInto: uuid("merged_into").references((): AnyPgColumn => items.id, {
      onDelete: "set null",
    }),
    /**
     * Rows sharing a key are one food to search, which returns only the best
     * match per key: name variants of one product, or the same food described
     * by several composition tables.
     */
    clusterKey: text("cluster_key"),
    /** Canonical English description shared across composition tables. */
    conceptName: text("concept_name"),
    iconSource: text("icon_source").notNull().default("rule"),
    servingLabel: text("serving_label").notNull(),
    caloriesPerServing: requiredAmount("calories_per_serving").default(0),
    proteinPerServing: requiredAmount("protein_per_serving").default(0),
    carbsPerServing: requiredAmount("carbs_per_serving").default(0),
    fatPerServing: requiredAmount("fat_per_serving").default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("items_barcode_idx").on(table.barcode),
    index("items_source_idx").on(table.source),
    index("items_ndb_number_idx").on(table.ndbNumber),
    index("items_merged_into_idx")
      .on(table.mergedInto)
      .where(sql`${table.mergedInto} is not null`),
    index("items_cluster_key_idx").on(table.clusterKey),
    index("items_quarantined_idx")
      .on(table.quarantined)
      .where(sql`${table.quarantined} = false`),
  ],
);

export const nutritionData = pgTable(
  "nutrition_data",
  {
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    // Nutrient amounts are always stored per 100 g/ml so rows from different
    // sources are directly comparable. The pack serving a product declares is
    // kept alongside rather than used as the basis, because a sixth of
    // OpenFoodFacts products mislabel which basis their numbers are on.
    servingLabel: text("serving_label").notNull(),
    servingQnty: requiredAmount("serving_qnty"),
    servingUnit: text("serving_unit").notNull(),
    packageServingLabel: text("package_serving_label"),
    packageServingQnty: numeric("package_serving_qnty", {
      precision: 12,
      scale: 3,
      mode: "number",
    }),
    packageServingUnit: text("package_serving_unit"),
    calories: nutrient("calories"),
    water: nutrient("water"),
    alcohol: nutrient("alcohol"),
    caffeine: nutrient("caffeine"),
    cholesterol: nutrient("cholesterol"),
    choline: nutrient("choline"),
    carbs: nutrient("carbs"),
    fiber: nutrient("fiber"),
    sugar: nutrient("sugar"),
    addedSugar: nutrient("added_sugar"),
    polyols: nutrient("polyols"),
    starch: nutrient("starch"),
    sucrose: nutrient("sucrose"),
    glucose: nutrient("glucose"),
    fructose: nutrient("fructose"),
    lactose: nutrient("lactose"),
    maltose: nutrient("maltose"),
    fat: nutrient("fat"),
    monoUnsaturated: nutrient("mono_unsaturated"),
    polyUnsaturated: nutrient("poly_unsaturated"),
    omega3: nutrient("omega_3"),
    omega3Ala: nutrient("omega_3_ala"),
    omega3Dha: nutrient("omega_3_dha"),
    omega3Epa: nutrient("omega_3_epa"),
    omega3Dpa: nutrient("omega_3_dpa"),
    omega6: nutrient("omega_6"),
    saturated: nutrient("saturated"),
    transFat: nutrient("trans_fat"),
    protein: nutrient("protein"),
    cysteine: nutrient("cysteine"),
    histidine: nutrient("histidine"),
    isoleucine: nutrient("isoleucine"),
    leucine: nutrient("leucine"),
    lysine: nutrient("lysine"),
    methionine: nutrient("methionine"),
    phenylalanine: nutrient("phenylalanine"),
    threonine: nutrient("threonine"),
    tryptophan: nutrient("tryptophan"),
    tyrosine: nutrient("tyrosine"),
    valine: nutrient("valine"),
    a: nutrient("a"),
    b1: nutrient("b1"),
    b2: nutrient("b2"),
    b3: nutrient("b3"),
    b5: nutrient("b5"),
    b6: nutrient("b6"),
    b12: nutrient("b12"),
    c: nutrient("c"),
    d: nutrient("d"),
    e: nutrient("e"),
    k: nutrient("k"),
    folate: nutrient("folate"),
    folateDfe: nutrient("folate_dfe"),
    retinol: nutrient("retinol"),
    caroteneBeta: nutrient("carotene_beta"),
    caroteneAlpha: nutrient("carotene_alpha"),
    cryptoxanthinBeta: nutrient("cryptoxanthin_beta"),
    lycopene: nutrient("lycopene"),
    luteinZeaxanthin: nutrient("lutein_zeaxanthin"),
    calcium: nutrient("calcium"),
    copper: nutrient("copper"),
    iron: nutrient("iron"),
    magnesium: nutrient("magnesium"),
    manganese: nutrient("manganese"),
    phosphorus: nutrient("phosphorus"),
    potassium: nutrient("potassium"),
    selenium: nutrient("selenium"),
    sodium: nutrient("sodium"),
    zinc: nutrient("zinc"),
    ash: nutrient("ash"),
    theobromine: nutrient("theobromine"),
    provenance: jsonb("provenance").$type<NutrientProvenance>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.itemId], name: "nutrition_data_item_id_pk" }),
  ],
);

/**
 * Every barcode an item answers to, in normalized form. The item's own barcode
 * is `primary`; codes absorbed from merged duplicates or completed from a
 * source that dropped the check digit are `alias`.
 */
export const itemBarcodes = pgTable(
  "item_barcodes",
  {
    barcode: text("barcode").primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("primary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("item_barcodes_item_id_idx").on(table.itemId)],
);

/** Household measures a composition table publishes with gram weights. */
export const itemPortions = pgTable(
  "item_portions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    grams: requiredAmount("grams"),
    sortOrder: integer("sort_order").notNull().default(0),
  },
  (table) => [
    uniqueIndex("item_portions_item_label_idx").on(table.itemId, table.label),
  ],
);

export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("api_keys_key_prefix_idx").on(table.keyPrefix),
    uniqueIndex("api_keys_key_hash_idx").on(table.keyHash),
    index("api_keys_active_key_hash_idx")
      .on(table.keyHash)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type FoodIcon = typeof foodIcons.$inferSelect;
export type NewFoodIcon = typeof foodIcons.$inferInsert;
export type NutritionData = typeof nutritionData.$inferSelect;
export type NewNutritionData = typeof nutritionData.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ItemBarcode = typeof itemBarcodes.$inferSelect;
export type ItemPortion = typeof itemPortions.$inferSelect;
export type NewItemPortion = typeof itemPortions.$inferInsert;
export type NewApiKey = typeof apiKeys.$inferInsert;
