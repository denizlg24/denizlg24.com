# Original food icons

The catalog contains 455 original food illustrations: 424 replacements
under the existing icon IDs, plus 31 additions. The installed catalog is recorded
in `assets/food-icons/icons.json` and mirrored to the web app's public assets.
No legacy screenshot pixels are used in the replacement artwork. Each installed
image is a transparent 128 × 128 PNG with
its aspect ratio preserved and its longest illustrated dimension fitted to 95 px.
This matches the web and native clients' existing optical sizing.

`config/food-icons/originals.json` records every subject and exact generation
prompt, the generation tool, legacy image checksums, and matching patterns for
new foods. Existing IDs retain their food meanings so stored foods, recipes,
and historical logs do not need to be rewritten.

## Prepare and install artwork

Generate one transparent image per entry using its recorded prompt. Stage each
result under `assets/food-icons/originals/<key>.png`. A raw generated PNG can be
prepared with:

```bash
bun run icons:prepare -- /path/to/generated.png assets/food-icons/originals/fruit-035.png
```

Install the complete staged set:

```bash
bun run icons:install
```

The installer validates and prepares every source before replacing published
files. It writes identical copies to `assets/food-icons/icons/` and
`../macros/public/food-icons/`, synchronizes both manifests, captions, and rules,
and removes the old screenshot grids and their active extraction configuration.
It refuses missing images, opaque source formats, or unchanged legacy bytes.
The staging directory is disposable once installation and checks pass; source
masters remain in the image tool's output directory.

The 31 additions cover sourdough; tofu, tempeh, seitan, quinoa, couscous,
buckwheat, bulgur, chickpeas, nutritional yeast, and acai bowls; oat, soy, and
almond milks, matcha, kombucha, coconut water, and kefir; chia, flax, pumpkin,
and hemp seeds and tahini; dragon fruit, lychee, and rambutan; edamame, kale,
and sauerkraut; skyr and Greek yogurt. Their specific rules take precedence
over broad rice, dairy, vegetable, and seed matches.

Both clients version image requests with `MACROS_FOOD_ICON_ASSET_VERSION` in
`@repo/schemas/macros`. The mobile catalog query uses that version too. Bump
it when replacing artwork under an existing ID so disk and query caches do
not retain older images.

## Validate

```bash
bun test src/modules/food-icons
```

Checks cover every original ID and addition, transparent bounds, distinct
artwork, replacement of legacy image bytes, agreement between public and
nutrition assets, valid rule references, and classification of new foods.

## Database storage and deployment

`items.icon_key` references `food_icons`, which stores an image once as base64
along with its human-readable `name`, media type, and group. Migration `0013` adds the name column. The default remains `other-001`.
Migration `0006` initially seeded it with a one-pixel placeholder; importing
the manifest upserts the finished artwork under the same keys.

After deploying static assets, update the nutrition database's stored artwork:

```bash
bun run icons:import
```

The importer refuses a manifest without `other-001`. Importing artwork does
not reassign foods or rewrite historical nutrition snapshots.

## Map foods deterministically first

Seed names and image bytes from the installed manifest, then seed a separate
Meilisearch icon catalog. The food search index is not cleared by this step.

```bash
bun run icons:import
bun run icons:index
bun run icons:match --dry-run --report /private/path/audit.json
bun run icons:match --llm-fallback --batch-size 20000 --backup /private/path/rollback.jsonl --report /private/path/applied.json
```

For each active, unmerged, nonquarantined item, the matcher searches
`concept_name`, otherwise `name_en`, otherwise the source name. The catalog
contains all 455 names plus food aliases from the captions/rules. Meilisearch
uses all query words, and the matcher requires whole-word coverage, a ranking
score of at least 0.97, and a gap of at least 0.02 between distinct results.
Prepared forms such as juice, oil, powder, flour, and butter are rejected when
the query lacks that form. Equivalent tied illustrations retain the current ID.
These are lexical scores, not probabilities of semantic correctness.

After search, an existing valid, specific `icon_source = 'llm'` assignment is
reused. Only unresolved/default foods reach the optional LLM fallback; responses
are checked against the installed keys. Do not pass `--refresh-llm` unless a
full paid reclassification is intended. Unrecognized foods may still retain
the generic Other icon. A generic model answer never replaces an existing
specific icon, including a rule-based assignment; this guard applies to both
cached and fresh model answers.

The versioned SQLite cache at `.impeccable/food-icons/search-cache.sqlite`
(relative to the repo root) avoids repeated search/model requests. The JSON
report checkpoints every batch. A private, newly created JSONL backup is
required for actual updates and is flushed before each batch is written.
Updates compare each row's previous key and source, preserving concurrent edits.
A rerun with a new backup path resumes safely using the cache and current rows.
No nutritional values or historical nutrition snapshots are changed.
`--unresolved-only` limits a retry to default or not-yet-classified rows; cached
valid answers are still reused. The model response schema enumerates installed
keys so it cannot invent a nonexistent icon ID.

Record the rollout's UTC start time, then synchronize changed food search
records after matching:

```bash
bun run search:sync -- --since <rollout-start-ISO-timestamp>
```

Meilisearch processes that sync asynchronously: verify its tasks have succeeded,
then invalidate the food-search cache generation again so requests made while
indexing cannot retain the prior keys. The Macros app refreshes stored external
food icon metadata through its existing source synchronization.

`icons:assign -- --only-additions --dry-run` remains a manual regex diagnostic.
Its optional `--backup` journals changes; it is not the preferred rollout path
when preserving existing model assignments.
