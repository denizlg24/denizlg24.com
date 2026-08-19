# @repo/ui

Shared React primitives for the monorepo.

The following exports are intentionally mobile-first and may currently be used
only by Macros: `bottom-tab-bar`, `keyboard-sheet`, `numeric-field`,
`numeric-keypad`, `segmented-control`, `sheet-form-footer`, `stepper-field`,
`swipe-row`, and `use-keyboard-inset`. They live here so keyboard, safe-area,
and touch behavior has one implementation rather than an app-local fork.
