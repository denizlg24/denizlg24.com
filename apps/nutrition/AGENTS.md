# apps/nutrition — nutrition API

## What bites

Moved in from the standalone `deniz-nutrition-api` repo (formerly run by hand
with docker compose on the Pi). Details in `apps/nutrition/README.md`.

- **Barcodes are stored as GTIN-14** (`@repo/macros-core/barcode`). Anything
  comparing a scanned code to a stored one goes through `barcodeLookupKeys` /
  `normalizeBarcode`; Macros' own `foods.barcode` still holds legacy spellings.
- **Imports upsert by barcode; never delete-and-reinsert.** Macros stores the
  API's item ids and refetches nutrition through them. A row a source drops is
  quarantined (`withdrawn_by_source`); a duplicate is `merged_into` its
  survivor. Both stay readable by id.
- **This API is the Meilisearch index's only writer.** The cloud collection
  that synced `items` is disabled and its trigger dropped; re-enabling it
  re-adds merged and quarantined rows. After any import: `search:sync --prune`.
- **Search answers are cached in Redis for 10 minutes**, keyed by an index
  generation that `SearchIndexer.index` and `search:sync` bump. A script that
  edits Postgres without either (icon assignment) shows up in search only once
  the TTL runs out — or run `search:sync` after it.
- **Forge never applies its migrations.** `bun run db:migrate` from
  `apps/nutrition` (env `.env.nutrition`) before merging a schema change.
- **NEVO and Fineli are deliberately absent**: NEVO's licence forbids altering
  the data; Fineli's CDN refuses scripted downloads.
