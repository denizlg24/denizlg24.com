# Deniz Nutrition API

Type-safe nutrition data API built with Bun, Elysia, Drizzle ORM, PostgreSQL, Meilisearch, and Redis-backed rate limiting.

The API serves searchable food item summaries, barcode lookup, full nutrition data, and contribution endpoints for manually entered food data.

## Features

- Fast item search by name and/or brand through Meilisearch.
- Barcode and item ID lookup.
- Reusable food icons with per-item icon assignment.
- Full nutrition data storage with quick item summaries derived from nutrition payloads.
- Redis-backed fixed-window rate limiting.
- Database-backed API keys for trusted clients that should bypass rate limits.
- PostgreSQL schema and migrations managed by Drizzle Kit.
- Global request IDs, structured JSON logs, centralized error responses, `/health`, and `/ready`.
- Type-safe OpenAPI documentation generated from Elysia schemas and TypeScript route types.
- Unit tests with Bun coverage.

## Tech Stack

- Runtime: Bun
- Framework: Elysia
- Database: PostgreSQL
- ORM: Drizzle ORM
- Search: Meilisearch
- Cache/rate limits: Redis
- Language: TypeScript

## Requirements

- Bun 1.4+ (monorepo workspace `apps/nutrition`, package `nutrition`)
- PostgreSQL, Redis and Meilisearch — all on the Pi cloud in production

## Environment

Local scripts read `.env.nutrition` at the monorepo root (`bun --env-file=../../.env.nutrition`):

```env
DATABASE_URL=postgres://…/proj_deniz_nutrition_api
REDIS_URL=redis://…
MEILISEARCH_HOST=https://search.denizlg24.com
MEILISEARCH_API_KEY=…            # write scope on the index
MEILISEARCH_INDEX=deniz-nutrition-api_foods
AI_GATEWAY_API_KEY=…             # icons:classify only
```

`PORT` (or `API_PORT`) defaults to 3000.

## Local Development

```bash
bun run dev:nutrition        # from the monorepo root
bun run --cwd apps/nutrition/frontend dev   # the query UI, proxied to :3000
```

## Deployment

Forge builds `apps/nutrition/Dockerfile` on every push to `main` and serves
`nutrition.denizlg24.com`. **Forge never applies migrations**: run
`bun run db:migrate` against production before merging anything that needs a
new schema. The bundle (`bun build`) and the frontend's `dist` are the only
things in the runtime image.

## Scripts

```bash
bun run sources:download            # every composition table into data/sources
bun run sources:download -- --only openfoodfacts   # the 13 GB export (opt-in)
bun run import:usda                 # Foundation + SR Legacy, merged per nutrient
bun run import:research             # FNDDS + every regional table (--source, --dry-run, --sample)
bun run import:branded              # USDA Global Branded Foods
bun run import:openfoodfacts        # OpenFoodFacts export (--resume)
bun run barcodes:normalize          # GTIN-14 rewrite + item_barcodes backfill (idempotent)
bun run dedupe:openfoodfacts        # merge product duplicates, cluster variants
bun run icons:classify              # LLM icons + concept names (resumable)
bun run concepts:link               # cluster the same food across tables, fill gaps
bun run search:sync -- --prune      # reindex, and drop merged/quarantined docs
bun run quality:audit -- --dry-run  # score every row against the validation gates
bun run db:backup                   # dump every table to backups/<timestamp>/
```

Every import upserts by barcode, so item ids survive a rebuild — Macros keeps
the id of every food it has logged. A full rebuild runs in the order listed.

## API Keys

Create a key with a human-readable name:

```bash
bun run api-key:generate -- --name "mobile-app"
```

Only the SHA-256 hash is stored in `api_keys`; the full key is printed once. Send it as either:

```http
x-api-key: dnut_...
authorization: Bearer dnut_...
```

Valid, non-revoked keys bypass Redis rate limits. Invalid or missing keys continue through normal rate limiting.

## Data Quality Model

Nutrient columns on `nutrition_data` are nullable. A `null` means the source did
not measure that nutrient; a `0` means it measured zero. These are different
facts and are never collapsed into one another. The denormalized
`*_per_serving` columns on `items` are a display projection for search results
and fall back to `0`; `GET /items/{id}/nutrition` is the authoritative view.

Each item records where it came from:

| Column | Notes |
|---|---|
| `source` | `usda_foundation`, `usda_sr_legacy`, `openfoodfacts`, `user`, `unknown` |
| `source_id` | fdcId, OpenFoodFacts code, or barcode |
| `ndb_number` | USDA identity, and the join key between Foundation and SR Legacy |
| `quality_flags` | Validation failures found for the row |
| `quarantined` | Excluded from search; still readable by id |

`nutrition_data.provenance` is a JSON map of nutrient to the source that
supplied that particular value, so a merged food records that (for example) its
calcium came from Foundation and its selenium from SR Legacy.

### Validation gates

`bun run quality:audit` scores every row against arithmetic that no real food can
violate, writes `quality_flags`, and sets `quarantined`:

- energy above 902 kcal per 100 g, and nutrients past physiological ceilings
  (skipped below a 5 g basis, where a supplement legitimately exceeds them)
- protein + fat + carbs + water + ash + alcohol exceeding the serving basis
- Atwater energy disagreeing with the macros by more than 30%
- containment breaches: sugar over carbs, added sugar over sugar, fatty acid
  fractions over total fat, omega-3 fractions over total omega-3
- rows with no energy or no macros at all
- USDA dry-matter entries, detected from a "(0% moisture)" name

```bash
bun run quality:audit -- --dry-run
bun run quality:audit -- --source openfoodfacts
bun run quality:audit -- --flag nutrient_over_ceiling  # reapply a changed rule
```

Quarantined rows stay in the database and remain reachable by id; they are
excluded from the search index by `bun run search:sync`.

## Sources

`GET /sources` lists every dataset with its licence and the citation it
requires (`src/modules/sources/catalog.ts`, which also sets search
preference). Composition tables (per 100 g edible portion, honest nulls):

| source | table | foods |
|---|---|---|
| `usda_foundation`, `usda_sr_legacy` | USDA Foundation + SR Legacy | ~7,965 |
| `usda_fndds` | USDA FNDDS 2021-2023 (foods as eaten, household portions) | 5,432 |
| `cnf` | Canadian Nutrient File 2015 | 5,690 |
| `cofid` | UK CoFID 2021 | 2,886 |
| `ciqual` | France ANSES-CIQUAL 2025 | 3,484 |
| `insa` | Portugal INSA TCA 2025 | 1,376 |
| `frida` | Denmark DTU Frida 6.1 | 1,390 |
| `bls` | Germany BLS 4.0 | 7,140 |
| `matvaretabellen` | Norway 2025 | 2,121 |
| `livsmedelsverket` | Sweden Livsmedelsdatabasen | 2,606 |
| `swiss_fcdb` | Switzerland FSVO | 1,246 |
| `afcd` | Australia AFCD Release 3 | 1,588 |

Each reader lives in `scripts/sources/readers/` and maps the table's own
nutrient codes and units; `scripts/sources/writer.ts` validates, quarantines
and upserts. A food a table drops is quarantined (`withdrawn_by_source`), never
deleted. Not imported: NEVO (its licence forbids altering the data) and Fineli
(its CDN refuses scripted downloads).

Products: `usda_branded` (~431k US products with GTINs, manufacturer data) and
`openfoodfacts`. For one barcode, manufacturer data wins and OpenFoodFacts only
fills what it lacks; a product a Macros user created keeps its own values.

## USDA Import

Foundation and SR Legacy overlap on `ndbNumber`. The importer merges those pairs
**per nutrient**: the lab-analyzed Foundation reading wins where it exists, and
SR Legacy fills everything Foundation did not measure. Barcodes are
`usda:{ndbNumber}`. Nutrient readings are unit-checked against
`nutrient.unitName`; a reading that cannot be converted is dropped instead of
written at the wrong magnitude.

## Barcodes

Every GTIN is stored as a 14-digit, zero-padded GTIN-14
(`@repo/macros-core/barcode`): EAN-8, UPC-A, EAN-13 and GTIN-14 are the same
number at different widths. `GET /items/barcode/:code` accepts any spelling and
tries, in order, the normalized form, a UPC-E expansion, the code with a
completed check digit, and the raw string. `item_barcodes` holds every code an
item answers to — its own, plus aliases for source codes saved without a check
digit. Namespaced ids (`usda:…`, `ciqual:…`) are kept as written.

A code the catalog lacks is fetched live from OpenFoodFacts, stored like an
imported product and indexed at once; misses are cached in Redis for a day.

## Duplicates and clusters

`dedupe:openfoodfacts` groups products by brand and a name stripped of pack
sizes and packaging. Rows whose macros agree within label rounding are one
product: the best (manufacturer data, most scanned, most complete, newest) is
kept and the rest get `merged_into` — still readable by id, their barcodes
resolve to the survivor, search drops them. Rows that disagree stay but share a
`cluster_key`, and search returns one hit per cluster.

`icons:classify` names every composition-table food with a coarse concept
("banana, raw"); `concepts:link` clusters the same concept across tables when
the macros agree and fills each member's unmeasured nutrients from the
best-ranked sibling, crediting the donor in `provenance`.

## OpenFoodFacts Import

The OpenFoodFacts importer streams `data/sources/openfoodfacts/openfoodfacts-products.jsonl.gz`
(13 GB compressed, ~4.7M products) and upserts by normalized barcode, recording
unique scans (`popularity`), last edit and the most specific category. Values are stored **per 100 g/ml**,
matching the USDA import, so rows from either source are directly comparable.

### Choosing the nutrition basis

OpenFoodFacts derives `*_100g` from `*_serving` when a contributor supplies only a
serving panel. When that contributor actually typed per-100 g numbers into the
serving fields, the derived `*_100g` is inflated by 100/serving — almonds arrive as
2280 kcal with 191 g of fat. Measured across a 120k-product sample, **16.2% of
products carrying energy data are affected**.

The importer therefore picks the basis by physical coherence rather than by field
name. A panel is accepted as per-100 g when its macros fit in 100 g, its energy is
under 902 kcal, and Atwater agrees with the stated calories:

1. `*_100g` if that panel is coherent
2. otherwise `*_serving` read as per-100 g — but only when a `*_100g` panel exists
   and is impossible, which is what proves the derivation was corrupt
3. otherwise `*_serving` scaled up by 100/serving
4. otherwise `*_100g` as-is, left for the quality gates to flag

Step 2 is deliberately narrow: without an impossible `*_100g` panel, a genuine 30 g
serving panel can look plausible as 100 g, and reinterpreting it would understate
the food threefold.

The product's declared serving is preserved in `package_serving_label`,
`package_serving_qnty` and `package_serving_unit` rather than used as the basis.

Batches upsert in two statements per 500 rows. `icon_key` is excluded from the
conflict clause so a re-import never clears assigned icons.

Import a bounded slice:

```bash
bun run import:openfoodfacts -- --start 0 --limit 10000
```

Resume from the latest checkpoint:

```bash
bun run import:openfoodfacts -- --resume
```

Useful options:

```bash
--file data/openfoodfacts-products.jsonl
--start 50000
--limit 10000
--batch-size 500
--resume
--checkpoint .import-state/openfoodfacts-import-checkpoint.json
--dry-run
```

The default checkpoint path is `.import-state/openfoodfacts-import-checkpoint.json`, which is ignored by Git.

## Search Index

PostgreSQL is the source of truth; Meilisearch only ranks. After any import or
quality audit the index must be resynced or search will return stale ids:
### Relevance

Two document fields exist purely for ranking:

- **`searchName`** — for composition-table rows, the comma-inverted description flattened and
  followed by its un-inverted short form, so `Rice, white, long grain` indexes as
  `Rice white long grain ... white Rice` and matches either phrasing. Non-USDA
  rows use the name unchanged. Both orders live in one attribute deliberately: a
  separate lower-ranked field loses to a branded product matching in `name`.
- **`sourceRank`** — the order of `sourceCatalog`: composition tables, then
  manufacturer data, user contributions, OpenFoodFacts.
- **`clusterKey`** — the distinct attribute; **`popularity`** breaks the last tie.

The ranking rules place `sourceRank:desc` between `wordPosition` and `exactness`.
Without it the 7,965 USDA foods returned **zero hits in the top 100** for
"chicken breast", "white rice", "olive oil", "banana" or "cheddar" — buried under
a million branded products. Placing it earlier (before `attributeRank`) was tried
and over-corrected: "coca cola" returned a POWERADE entry and "banana" returned
banana peppers.

At the current placement, brand queries resolve to products and most whole-food
queries resolve to USDA. Queries where a branded product carries the exact
generic name ("Olive oil", "Cheddar", "Almonds") still return that product,
because an exact full-name match wins before `sourceRank` applies. Moving the
rule earlier trades those back against brand queries; it is a product decision,
not a correctness one.

### Writers

This API is the index's only writer: `search:sync` for bulk changes, and the
API itself for rows it creates (contributions, live lookups). The cloud's
Postgres→Meilisearch collection for `items` is disabled and its trigger
dropped — it re-added merged and quarantined rows on every update.

```bash
bun run search:sync -- --dry-run
bun run search:sync -- --since 2026-10-04 --prune
```

This needs `MEILISEARCH_API_KEY` to hold a key with **write** scope on the index.
A search-only key returns 403.

## Backups

`bun run db:backup` writes every table to `backups/<timestamp>/*.jsonl.gz` using
only the `pg` driver, so it needs no `pg_dump` on the host. Run it before any
destructive import.

## Food Icons

Each item stores an `iconKey`; the corresponding PNG base64 is stored once in `food_icons`. This avoids duplicating the same image across many item rows. Existing and newly inserted items default to `other-001`.

The screenshot workflow supports continued grids, optional connected-background removal, deterministic cell splitting, database import, and prioritized regex assignment. See [Food icon processing](docs/food-icons.md) for the complete workflow.

The regex rules miss a third of the catalog, so `icons:classify` reassigns
every icon with `openai/gpt-6-luna` through the AI Gateway (`icon_source =
'llm'`; reruns skip classified rows). The model sees one line per icon: the
rule terms, or a hand-written caption from `config/food-icons/captions.json`
for the 147 icons no rule describes.

## API Overview

OpenAPI:

- `GET /docs`
- `GET /docs/json`

Health and readiness:

- `GET /health`
- `GET /ready`

Items:

- `GET /items/search?q={query}&brand={brand}&lang={lang}&minScore={score}&limit={limit}`
- `GET /items/barcode/{barcode}`
- `GET /items/{id}`
- `GET /items/{id}/nutrition`
- `GET /items/{id}/portions`
- `GET /sources`
- `POST /items`
- `PUT /items/{id}`
- `PUT /items/{id}/nutrition`

Food icons:

- `GET /food-icons`
- `GET /food-icons/{key}`

Item create requests accept core item identity plus a required `nutrition` payload. The item summary fields are calculated from that nutrition payload and refreshed whenever nutrition data is updated.

## Observability

Every request receives or reuses an `x-request-id`. Logs are emitted as structured JSON with method, path, status, duration, and request ID. Unexpected errors are logged centrally and returned as stable API error envelopes.

## Testing

Run all tests:

```bash
bun run test
```

Run coverage:

```bash
bun run test:coverage
```
