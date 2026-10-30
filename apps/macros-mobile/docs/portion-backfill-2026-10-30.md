# Portion backfill — October 30, 2026

Applied `apps/nutrition/scripts/propagate-portions.ts` to the configured nutrition
database after inspecting a dry run and backing up all 82,322 original portion
rows to `/tmp/nutrition-portions-before-20261030.json` on the execution machine.

The backfill uses existing published portions from matching food concepts and
compatible energy densities. It preserves published and estimated rows, replaces
borrowed rows with donor provenance, and supplements sparse source portions.
Donors with several usable measures now beat donors with one odd measure.
Asian/nashi pears cannot supply portions for ordinary European pears.

Verified after applying:

- 112,955 total portion rows; 58,929 borrowed rows across 21,813 foods.
- All 54,026 source-published and estimated rows remained identical, including
  weights, labels, order and provenance.
- 3,600 foods gained usable portions where they previously had none.
- 12,615 foods offer more usable measures than before.
- Black plums offer a 66 g fruit and a 165 g sliced cup alongside the retained
  regulatory source row.
- William Bartlett pears and Frida’s ordinary raw pears offer small (152 g),
  medium (177 g), large (227 g), and a sliced cup (140 g).
- One Nashi entry lost previously borrowed European-pear sizes: no compatible
  Asian-pear donor passes the energy-density check. It remains weight-only.

The app also preserves dimensions when they distinguish otherwise unnamed fruit
sizes, so Asian-pear sizes no longer collapse to one “fruit” option. Regulatory
RACC and NLEA amounts are excluded from household choices.

The food cache revision is bumped in `packages/schemas/src/macros/cache-versions.ts`.
Deploying the Macros backend publishes that revision to installed clients.
The normalization and citation changes require a new native build.

The configured Redis endpoint was unreachable during invalidation. Search
answers expire within ten minutes; food-detail portions are read from the
database. The backfill committed successfully.
