# Changelog

What changed in each release of Macros for iPhone and Android, newest first.
The site (`/changelog`) and the app (Settings → What's new) both render this
file. Each release is a `## <version> — <YYYY-MM-DD>` heading, optionally
grouped under `### Added`, `### Changed`, `### Fixed`; inside a release only
bullets, paragraphs, **bold**, `code` and [links](https://macros.denizlg24.com)
are understood.

## 0.1.1 — 2026-10-25

### Fixed
- Stocking food in the pantry works again: the amount keypad and Save show
  when you add something from search, a scan or the shopping list.
- Long names in the pantry no longer push the stepper off the row.

## 0.1.0 — 2026-10-23

### Changed
- The website's film now shows the latest app and original food illustrations.
- Food data and illustrations can refresh automatically after a catalogue
  update, without reinstalling the app.
- App requests use a versioned API so future releases can keep older apps
  working.

### Fixed
- Long food and recipe names stay within their pantry rows, keeping stock
  controls visible.
- App updates and food-cache refreshes preserve queued offline writes.

## 0.0.20 — 2026-10-23

### Added
- **31 more food icons.** Specific illustrations for foods including plant
  milks, Greek yogurt, skyr, tofu, chia seeds and fermented foods.

### Changed
- **Fresh food illustrations.** All 455 icons now use original, colorful
  artwork throughout the app and website.
- More foods have a specific illustration, with existing assignments reused
  where a clearer match is unavailable. Your logged nutrition stays intact.

### Fixed
- Updated food artwork refreshes in the app instead of keeping an older
  cached image.

## 0.0.19 — 2026-10-22

### Added
- **Scan into your pantry.** Scan a barcode from the pantry to stock it in
  one step. A product nobody has added yet can be read from its label or
  entered by hand, and lands straight in your pantry.
- **Store cooked meals.** Put a batch you cooked in your pantry from the
  recipe's menu. Its ingredients come out of stock once, and logging the
  recipe eats the stored servings first.
- **Name ingredients your way.** Hold an ingredient in a recipe to rename
  it: "kidney beans" instead of a brand's full product name. Published
  recipes show only that name.

### Changed
- Edit a recipe's ingredients after saving or publishing it: change
  amounts, add or remove foods, and the nutrition is recalculated.
- Published recipes show each ingredient's food icon.

## 0.0.18 — 2026-10-21

### Added
- **Kitchen.** A new tab for your recipes, pantry and shopping list, with
  My foods a tap away. It takes More's place in the tab bar; Body, Habits
  and Settings now open from the person button on Today.
- **Cook mode.** Step through a recipe one page at a time in large type,
  tick off ingredients as you go and log what you made at the end. The
  screen stays on while you cook.
- **Ready to cook.** Recipes your pantry covers are marked Ready, lead the
  Kitchen and show up on Today.
- **Pantry in real measures.** Stock food in heads, pieces, cups or grams
  and step it up or down from the list. Foods running low and out of stock
  are grouped, and an empty one goes on your shopping list with a swipe.
- Food search shows matching recipes and marks food you have in your
  pantry.

### Changed
- Recipes are photo-led. Scale a recipe's servings, see which ingredients
  your pantry covers and add the missing ones to your list in one tap.
- Logging a recipe uses up its ingredients from your pantry.
- A food you check off your shopping list can go straight into your pantry.

## 0.0.17 — 2026-10-21

### Added
- **Pantry.** Keep track of what you have at home in More › Pantry. Logging
  a food uses up its stock, and foods you have on hand come first in search.
- **Activity.** Steps and active energy get their own screen, reachable from
  Today and Progress, with daily readings, trends and manual corrections.
- **Activity widget.** Today's steps and active energy on the Home Screen and
  Lock Screen.

### Changed
- The Shortcuts import guide is gone from Settings. Sync with Health brings in
  your weight, steps and active energy directly.

## 0.0.16 — 2026-10-18
### Added
- **Share your recipes** You can now create beautiful recipe pages and share them with your friends online

### Fixed
- You can now choose quantities when creating a recipe from the recipes page.
- Scrolling a search now puts the keyboard away.
- Choosing a food icon closes the icon grid.
- Date of birth and goal date close their calendar once a day is picked.
- Onboarding points out the optional answers left empty before moving on.

## 0.0.15 — 2026-10-08

### Added
- **Report a shared food.** Foods other people added with a barcode now have
  a flag button: report one and it disappears from your searches while it is
  reviewed.
- **Hide a contributor.** Stop seeing every food the same person added.
  Undo it in Settings › Hidden Contributors.

### Changed
- Foods you share are checked before they join the database; one that can’t
  be shared is saved to your foods only, and the app says why.

## 0.0.14 — 2026-10-06

### Fixed
- **Deleting your account works again**, along with progress photos. Both
  were failing on the server.

## 0.0.13 — 2026-10-06

### Changed
- **Macros for iPhone installs through TestFlight.** Apple Health, reminders
  and widgets work in every iPhone build.

## 0.0.12 — 2026-10-06

### Added
- **Widgets on iPhone.** Add **Quick Log** to your Home Screen to log food,
  scan a barcode, quick add or weigh in with one tap, or put a **Shortcut**
  on your Lock Screen for the one you use most.
- **Today** and **Weight Trend** widgets show your calories, macros and
  weight trend at a glance. They arrive with the App Store version of Macros.

### Changed
- Opening Macros from a widget or a link that goes straight to a sheet now
  keeps your tabs underneath it.

## 0.0.10 — 2026-10-05

### Added
- **What's new** in Settings, so you can see what each update changed.

### Fixed
- Food search updates as you type. You no longer have to press Search to see
  results for the last letters you typed.
- Results from an earlier search no longer show up under a new one.
- A food you open for the first time loads right away instead of spinning
  until you close and reopen it.
- Searching is faster, because common searches are now answered from a cache.

## 0.0.9 — 2026-10-04

### Changed
- Food icons are refreshed after the food catalogue was rebuilt.

## 0.0.8 — 2026-10-04

### Added
- Home Screen quick actions: press and hold the app icon to search, scan, quick
  add or log your weight.
- Press and hold an entry in the log for Edit, Duplicate, Move, Copy to today,
  Copy to… and Select. Tap an hour to act on everything logged in it.

### Fixed
- The "will sync when you're back online" notice only shows when you are
  actually offline.

## 0.0.7 — 2026-10-03

### Fixed
- The Android release could not be published.

## 0.0.6 — 2026-10-03

### Added
- The first signed Android release.

## 0.0.5 — 2026-10-02

### Added
- A water sheet with a glass you can fill and a cups readout.

### Changed
- Logging is instant: your plate empties and your totals update before the
  server answers.
- The plate is back as a button in the top right of Add food.

### Fixed
- The calorie pill no longer counts a plate twice while it is being logged.
- Food and recipe sheets open tall enough to keep the macros above the keypad.

## 0.0.4 — 2026-10-01

### Added
- An amount keypad that understands fractions like ½ and 1 ¼.
- Drag an entry in the log to move it through the day in 15-minute steps.

### Fixed
- Cancel and Save on the edit-entry sheet respond to taps again.

## 0.0.1 — 2026-09-28

The first release of Macros for iPhone.
