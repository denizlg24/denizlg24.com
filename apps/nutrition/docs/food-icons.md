# Food icon processing

The pipeline preserves the pixels from the source screenshots. It does not redraw or generate icons.

## Storage model

`items.icon_key` attaches an icon to each food. `food_icons` stores the image once as base64, together with its media type and food group. The default key is `other-001`.

Migration `0006` initially seeds `other-001` with a transparent one-pixel placeholder so the foreign key can be added safely to existing rows. Importing the processed icon set replaces that placeholder with the first real icon from the Other tab.

## 1. Add and describe screenshots

The source screenshots are kept in `data/food-icons/screenshots/`. The `data/` directory is intentionally ignored by Git, while the processed assets are committed under `assets/food-icons/` for deployment.

The checked-in `config/food-icons/sheets.json` describes the 13 MacroFactor screenshots and their continuation pages. To process a different set, copy `config/food-icons/sheets.example.json` and adjust it. Add screenshots in display order. Continuations of a tab must use the same `foodGroup`; numbering continues automatically across those sheets.

For every sheet, set:

- `crop`: the exact icon-grid rectangle in screenshot pixels.
- `grid.columns` and `grid.rows`: the number of cell slots in that crop.
- Grid padding and gaps: space around and between cells.
- `skipCells`: blank positions as one-based `{ "row": 1, "column": 1 }` coordinates.

## 2. Crop the grids

```bash
bun run icons:process -- crop
```

Cropped grids are written to `assets/food-icons/grids/` by the checked-in configuration.

## 3. Remove the background

For automatic removal of a uniform background connected to the image edges:

```bash
bun run icons:process -- remove-background
```

The configured dark-neutral background is removed from pixels connected to the grid edges. Cleared pixels have both alpha and RGB reset, avoiding dark matte artifacts in imperfect image viewers. If the automatic result removes part of an icon, edit the cropped grid externally and save it under `assets/food-icons/background-removed/` with the same filename.

To run crop, background removal, and splitting together:

```bash
bun run icons:process -- all
```

## 4. Split into individual PNG files

```bash
bun run icons:process -- split
```

The output is written to `assets/food-icons/icons/`. The current set contains 424 transparent 128×128 PNG files. Keys use `<food-group>-001` and continue in row-major order across continuation sheets. The command also writes `assets/food-icons/icons.json`, which is consumed by the database importer.

The splitter trims empty pixels but never enlarges an icon beyond its native screenshot size. It preserves aspect ratio, centers the result, and reserves transparent canvas padding.

To split the cropped images before background removal for a quick alignment check:

```bash
bun run icons:process -- split --use-cropped
```

## 5. Import icon assets

Apply migrations, then upsert the generated icon manifest:

```bash
bun run db:migrate
bun run icons:import
```

The importer refuses a manifest without `other-001`, preventing the default asset from remaining a placeholder accidentally.

## 6. Assign icons with regex rules

The checked-in `config/food-icons/rules.json` contains the initial matching set. Rules inspect the combined item name and brand, case-insensitively. Higher `priority` rules win when patterns overlap. Any unmatched item receives `defaultIconKey`, which should remain `other-001`.

Preview counts without writing:

```bash
bun run icons:assign -- --dry-run
```

Assign in bounded database batches:

```bash
bun run icons:assign -- --batch-size 10000
```

The script validates that every referenced key exists in `food_icons` before changing any items. Re-running it is safe: rows whose assignment is unchanged are not updated.
