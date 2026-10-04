import { researchSources } from "../../db/schema";
import { sourceRankFor } from "../sources/catalog";

export { sourceRankFor };

const invertedSources = new Set<string>(researchSources);

/**
 * Composition tables write descriptions comma-inverted ("Chicken, broiler or
 * fryers, breast, skinless, boneless, meat only, raw"), which scores badly
 * against a natural query like "chicken breast": the words are present but
 * far apart, and a branded product literally named "Chicken Breast" wins on
 * proximity and exactness. Dropping the commas puts the descriptive terms in
 * one flat phrase and pulls the head noun and its qualifier closer together.
 */
export const buildSearchName = (name: string, source: string) => {
  if (!invertedSources.has(source)) return name;

  const segments = name
    .split(",")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length < 2) return name;

  const [head, ...rest] = segments;
  // Parenthetical asides ("(Includes foods for USDA's Food Distribution
  // Program)") are noise for matching.
  const cleaned = rest
    .map((segment) => segment.replace(/\([^)]*\)/g, "").trim())
    .filter(Boolean);

  const flattened = [head, ...cleaned].join(" ");
  const alias = cleaned.length > 0 ? `${cleaned[0]} ${head}` : undefined;

  // Both word orders live in one attribute so either phrasing matches at the
  // same attribute rank. A separate lower-ranked field loses to a branded
  // product that happens to match in `name`.
  return alias ? `${flattened} ${alias}` : flattened;
};

export type SearchableRow = {
  id: string;
  barcode: string;
  name: string;
  nameEn: string | null;
  brand: string | null;
  iconKey: string;
  source: string;
  region: string | null;
  foodGroup: string | null;
  popularity: number;
  clusterKey: string | null;
  servingLabel: string;
  caloriesPerServing: number;
  proteinPerServing: number;
  carbsPerServing: number;
  fatPerServing: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

export const searchSettings = {
  searchableAttributes: ["searchName", "name", "nameEn", "brand", "barcode"],
  filterableAttributes: [
    "brand",
    "source",
    "iconKey",
    "sourceRank",
    "region",
    "clusterKey",
  ],
  sortableAttributes: ["sourceRank", "popularity"],
  /**
   * One hit per cluster: the name variants of a product and the same food
   * described by several composition tables collapse to their best match.
   */
  distinctAttribute: "clusterKey",
  /**
   * sourceRank sits between wordPosition and exactness: late enough that a
   * genuinely better text match still wins (so "nutella" and "coca cola"
   * return products), early enough to break the tie that otherwise buries
   * lab-analyzed foods under a million product labels. Placing it before
   * attributeRank was tried and over-corrected, surfacing banana peppers for
   * "banana". popularity breaks what is left, which inside a cluster is
   * every variant of the same name.
   */
  rankingRules: [
    "words",
    "typo",
    "proximity",
    "attributeRank",
    "sort",
    "wordPosition",
    "sourceRank:desc",
    "exactness",
    "popularity:desc",
  ],
};

export const buildSearchDocument = (row: SearchableRow) => ({
  ...row,
  createdAt: new Date(row.createdAt).toISOString(),
  updatedAt: new Date(row.updatedAt).toISOString(),
  clusterKey: row.clusterKey ?? row.id,
  searchName: buildSearchName(row.name, row.source),
  sourceRank: sourceRankFor(row.source),
});

export type SearchDocument = ReturnType<typeof buildSearchDocument>;

/** Columns a SearchableRow is read with, for raw SQL callers. */
export const searchableColumnsSql = `
  id, barcode, name, name_en as "nameEn", brand, icon_key as "iconKey", source,
  region, food_group as "foodGroup", popularity, cluster_key as "clusterKey",
  serving_label as "servingLabel",
  calories_per_serving::float as "caloriesPerServing",
  protein_per_serving::float as "proteinPerServing",
  carbs_per_serving::float as "carbsPerServing",
  fat_per_serving::float as "fatPerServing",
  created_at as "createdAt", updated_at as "updatedAt"`;

/** Rows search may return: not quarantined and not merged into another. */
export const searchableWhereSql = "quarantined = false and merged_into is null";
