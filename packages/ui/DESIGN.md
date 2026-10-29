# Admin design system

The contract every admin surface (desktop app, web `/admin`) is built to.
Single owner, full context: terse, data-dense, editorial. Typography and
hairlines carry structure — not boxes.

## Page anatomy

```tsx
import { Page, PageHeader, PageToolbar, PageBody, PageTitle } from "@repo/ui/page";

<Page>
  <PageHeader leading={slots?.sidebarTrigger} icon={<Inbox />} title="Inbox" crumbs={…}>
    {/* header actions: ghost icon buttons + at most one primary button */}
  </PageHeader>
  <PageToolbar>{/* SearchField · FilterTabs · ToolbarSpacer · view controls */}</PageToolbar>
  <PageBody width="default">{/* Sections */}</PageBody>
</Page>
```

- `PageHeader` is h-11. Title is the module or record name. Record pages pass
  `crumbs` back to their list (`DetailPageShell` in `@repo/admin` does this).
  The leading slot is always `useAdmin().slots?.sidebarTrigger`.
- `PageToolbar` only when the page filters or searches. Never stack two.
- `PageBody` scrolls; `width`: `narrow` (forms, documents, settings),
  `default` (most pages), `wide` (tables, boards), `full`. Canvases, editors
  and split views use `bleed`.
- A record's own page opens with `PageTitle` (big title + meta row), then
  `Properties` for its fields, then sections.
- Split list/detail surfaces (inbox, notes, people, journal): `SplitView` +
  `SplitList` from `@repo/ui/split-view`.

## Building blocks

| Need | Use | Not |
|---|---|---|
| Section of a page | `Section` / `SectionLabel` (`@repo/ui/section`) — uppercase 11px label running into a hairline | bordered `rounded-md border` boxes, `Card` |
| Figures | `Stat` in a `StatGroup` (`@repo/ui/stat`) | stat tiles with borders/backgrounds |
| Rows of records | `List` + `ListRow` (`@repo/ui/list`), wrapped in a `Link` to navigate; `ListGroupLabel` for date groups | custom flex rows with ad-hoc hover |
| Tabular data | `DataTable` / `PaginatedDataTable` | hand-built tables |
| Record fields | `Properties` + `Property` (`@repo/ui/properties`) | label/value grids rolled per page |
| Nothing to show | `EmptyState` (`@repo/ui/empty-state`): glyph + terse label ("No notes") + optional single action | instructions, "Get started by…" |
| Progress | `Meter` (`@repo/ui/meter`) — hairline | chunky `Progress` bars |
| Search/filters | `SearchField`, `FilterTabs`, `ToolbarSpacer` (`@repo/ui/toolbar`) | Input with a hand-placed icon; pill `TabsList` for filters |
| Row/record menu | `RowActions` (`@repo/ui/toolbar`) with `DropdownMenuItem`s | ad-hoc `…` buttons |
| Create/edit | `FormDialog` + `FormField` + `FormGrid` (`@repo/ui/form-dialog`) | hand-rolled `DialogContent` with its own header/footer |
| Confirm | `ConfirmButton` (trigger) / `ConfirmDialog` (controlled), `destructive` for deletes | `window.confirm`, bespoke alert dialogs |
| Loading | content-shaped `Skeleton`s; `@repo/ui/skeleton-blocks` | spinners in the middle of a page |
| Status | `Badge` variants `good` / `warning` / `critical` / `info` / `secondary` / `outline`; `StatusDot` | hand-coloured spans |

## Dialogs

Wide and tall, scrolling inside. `FormDialog` defaults to `max-w-3xl`; large
editors pass `size="lg"` (`max-w-5xl`). Height caps at ~85vh; the header and
footer stay fixed and the body scrolls. `size="sm"` is for confirmations only
— never shrink an ordinary dialog to fit its content. Lay fields out with
`FormGrid` (two columns) so wide dialogs use their width.

Footer: Cancel (ghost) then the primary action, right-aligned; a destructive
secondary action (Delete) goes in `footerStart`. Submit with Enter works.

## Buttons

- One `default` (filled) button per view at most — the primary action.
- Header and row actions are `ghost`, `size="icon-sm"` with an `aria-label`,
  or `ghost size="sm"` with an icon + short label.
- `outline` for secondary actions next to a primary one. `destructive` only
  inside a confirmation or a dialog's `footerStart`.
- Sizes: `sm` (h-7) in toolbars and headers, `default` (h-8) in forms and
  dialogs. Don't mix sizes within one row.
- No raw `<button>` with hand-written styling where `Button` fits; a raw
  button is fine only for a bespoke surface (a calendar cell, a canvas tool).

## Typography and colour

- Body `text-sm`; secondary `text-xs text-muted-foreground`; emphasis
  `text-accent-strong` (it inverts correctly in dark mode — never hard-code
  colours); numbers `tabular-nums`; big figures `font-calistoga`.
- Labels: `text-[11px] uppercase tracking-[0.08em] text-muted-foreground`.
- Hover surfaces are `bg-surface` (or `/70`), never `bg-accent` (too loud).
- Status colours come from `--status-*` tokens only.
- No shadows on in-page elements; only overlays (dialogs, menus, popovers) cast them.

## Copy

No explanatory copy: no onboarding, feature blurbs, "how it works", tooltips
that explain mechanics. Labels are nouns; buttons are verbs ("Add", "Save",
"Delete"). Empty states are a label or a count. Relative dates for recent
things (`3d ago`), absolute for scheduled ones.
