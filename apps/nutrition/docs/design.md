# deniz-nutrition-api

## Goal

This system serves clients with nutrition data. Users can request nutrition data by text search or barcode lookup and contribute manually entered data.

---

## Technology

| Layer | Choice |
|---|---|
| **Package Manager** | [Bun](https://bun.sh/) |
| **Framework** | [Elysia.js](https://elysiajs.com/) |
| **Database** | PostgreSQL |
| **Search** | Meilisearch |

---

## Data Models

### `item`

The lightweight, searchable representation of a food product.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID / serial | Primary key |
| `barcode` | text | Unique. `usda:{ndbNumber}` for USDA foods |
| `name` | text | Product name |
| `brand` | text | Optional |
| `icon_key` | text | Foreign key → `food_icons.key`; defaults to `other-001` |
| `source` | text | `usda_foundation`, `usda_sr_legacy`, `openfoodfacts`, `user`, `unknown` |
| `source_id` | text | fdcId, OpenFoodFacts code, or barcode |
| `ndb_number` | text | USDA identity; the Foundation ↔ SR Legacy join key |
| `quality_flags` | text[] | Validation failures found for this row |
| `quarantined` | boolean | Excluded from search; still readable by id |
| `serving_label` | text | Human-readable serving description (e.g. "1 cup") |
| `calories_per_serving` | numeric | Display projection; falls back to 0 |
| `protein_per_serving` | numeric | Display projection; falls back to 0 |
| `carbs_per_serving` | numeric | Display projection; falls back to 0 |
| `fat_per_serving` | numeric | Display projection; falls back to 0 |

---

### `food_icons`

Stores each reusable image once. Item rows reference the asset by key rather than duplicating base64 data.

| Column | Type | Notes |
|---|---|---|
| `key` | text | Primary key, e.g. `other-001` |
| `food_group` | text | Source tab/group |
| `media_type` | text | Defaults to `image/png` |
| `image_base64` | text | Raw base64 without the data-URL prefix |

---

### `nutrition_data`

The full, detailed nutrition breakdown linked to an item.

Nutrient amounts are stored **per 100 g/ml** for every source, so rows are
directly comparable. The serving a product declares is kept in the
`package_serving_*` columns rather than used as the basis, because OpenFoodFacts
mislabels which basis its numbers are on for about a sixth of products.

Every nutrient column is **nullable**. `null` means the source did not measure the
nutrient; `0` means it measured zero. The two are never collapsed. `provenance`
is a JSON map of nutrient name to the source that supplied that value, so a
merged food records per nutrient where each number came from.

#### General

| Column | Notes |
|---|---|
| `item_id` | Foreign key → `item.id` |
| `serving_label` | Always `100 g`; the basis every nutrient is stored on |
| `serving_qnty` | Always `100` |
| `serving_unit` | `g` |
| `package_serving_label` | The serving the product declares, e.g. `28 g` |
| `package_serving_qnty` | Declared serving quantity, nullable |
| `package_serving_unit` | Declared serving unit, nullable |
| `calories` | |
| `water` | |
| `alcohol` | |
| `caffeine` | |
| `cholesterol` | |
| `choline` | |

#### Carbohydrates

| Column |
|---|
| `carbs` |
| `fiber` |
| `sugar` |
| `added_sugar` |
| `polyols` |
| `starch` |
| `sucrose` |
| `glucose` |
| `fructose` |
| `lactose` |
| `maltose` |

#### Fats

| Column |
|---|
| `fat` |
| `mono_unsaturated` |
| `poly_unsaturated` |
| `omega_3` |
| `omega_3_ala` |
| `omega_3_dha` |
| `omega_3_epa` |
| `omega_3_dpa` |
| `omega_6` |
| `saturated` |
| `trans_fat` |

#### Protein & Amino Acids

| Column |
|---|
| `protein` |
| `cysteine` |
| `histidine` |
| `isoleucine` |
| `leucine` |
| `lysine` |
| `methionine` |
| `phenylalanine` |
| `threonine` |
| `tryptophan` |
| `tyrosine` |
| `valine` |

#### Vitamins

| Column | Vitamin |
|---|---|
| `a` | Vitamin A |
| `b1` | Thiamine |
| `b2` | Riboflavin |
| `b3` | Niacin |
| `b5` | Pantothenic Acid |
| `b6` | Pyridoxine |
| `b12` | Cobalamin |
| `c` | Vitamin C |
| `d` | Vitamin D |
| `e` | Vitamin E |
| `k` | Vitamin K |
| `folate` | Folate / B9, total |
| `folate_dfe` | Folate, dietary folate equivalents |
| `retinol` | Preformed vitamin A |
| `carotene_beta` | Beta-carotene |
| `carotene_alpha` | Alpha-carotene |
| `cryptoxanthin_beta` | Beta-cryptoxanthin |
| `lycopene` | Lycopene |
| `lutein_zeaxanthin` | Lutein + zeaxanthin |

#### Minerals

| Column |
|---|
| `calcium` |
| `copper` |
| `iron` |
| `magnesium` |
| `manganese` |
| `phosphorus` |
| `potassium` |
| `selenium` |
| `sodium` |
| `zinc` |

#### Other

| Column | Notes |
|---|---|
| `ash` | Mineral residue; used by the mass-balance check |
| `theobromine` | |
| `provenance` | JSON map of nutrient → source that supplied the value |

---

### Search

Item search is served by Meilisearch using the `deniz-nutrition-api_foods` index by default. PostgreSQL remains the source of truth for item lookup, nutrition data, and writes.

**Supported languages:** `english`, `portuguese`, `spanish`, `french`

**Query behavior:**
- The caller provides `q`, `brand`, or both.
- `q` and `brand` are combined into a Meilisearch query string.
- The caller may still provide an optional `lang` parameter for API compatibility.
- `rank` and `score` are derived from Meilisearch's ranking score.
- Icon keys are refreshed from PostgreSQL after ranking so assignments do not depend on Meilisearch reindex timing.

---

## API Endpoints

### Items — Search & Lookup

| Method | Path | Description |
|---|---|---|
| `GET` | `/items/search?q={query}&brand={brand}&lang={lang}&minScore={score}&limit={limit}` | Full-text search for items by name, brand, or both |
| `GET` | `/items/barcode/{barcode}` | Look up an item by barcode |
| `GET` | `/items/{id}` | Get item summary by ID |
| `GET` | `/items/{id}/nutrition` | Get full nutrition data for an item |

### Items — Contribution

| Method | Path | Description |
|---|---|---|
| `POST` | `/items` | Manually create a new item with nutrition data |
| `PUT` | `/items/{id}` | Update an existing item's core fields |
| `PUT` | `/items/{id}/nutrition` | Update full nutrition data for an item |

### Food Icons

| Method | Path | Description |
|---|---|---|
| `GET` | `/food-icons` | List reusable icon metadata |
| `GET` | `/food-icons/{key}` | Get one icon as raw base64 and a data URL |
