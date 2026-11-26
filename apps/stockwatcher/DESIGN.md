# Stockwatcher design

## Direction

A trading desk set like a financial daily. Content sits directly on one paper surface and is organised by **rules and whitespace**, not boxes. Each section opens with a 1px ink rule and a small uppercase label. Rows are separated by hairlines. Numbers are dense, tabular, and always carry source, timestamp, and currency.

The owner called the previous UI "super cardy boxy". If you are about to add a border, a radius, a background, and a shadow around a block of content, stop and use a ruled section instead.

Mode: **Operate**. Scanability and density matter more than expression. The brand shows in the type, the rules, and the forest accent, never in decoration.

## Tokens

Defined in `app/globals.css` on `:root`. Dark values are set under `:root[data-theme="dark"]` and again under `prefers-color-scheme: dark` when no light theme is forced. Always use the token, never a raw hex.

### Colour

| Token | Light | Dark | Use |
|---|---|---|---|
| `--background` | `#f5f5ef` | `#111412` | The page. Sections sit directly on it. |
| `--card` | `#fbfbf7` | `#181c19` | Surfaces that float or take input: inputs, selects, popovers, dialogs, tooltips, toasts. **Not for sections.** |
| `--sidebar` | `#ecece4` | `#0c0f0d` | Sidebar only. |
| `--foreground` | `#121814` | `#e6ebe5` | Ink. |
| `--muted-foreground` | `#566059` | `#9aa49d` | Secondary text, labels, meta. At least 4.5:1 on the background. |
| `--muted` | `#eaebe3` | `#1e2420` | Hover fills, skeletons, segmented track. |
| `--rule` (`--border`) | `#dcddd4` | `#272e29` | Hairlines between rows and inside sections. |
| `--strong-border` | `#bfc3b8` | `#3a433d` | Control borders, table header underline. |
| `--rule-strong` | `#1f2622` | `#6b756e` | The section-opening rule. One per section. |
| `--primary` | `#174e3a` | `#a7d7b4` | Primary action, the selected benchmark marker, the brand mark. |
| `--secondary` / `--secondary-foreground` | `#e1e9df` / `#1d4734` | `#203429` / `#c4e4cc` | Selected list item, links (`.source-link`). |
| `--gain` / `--loss` | `#1b6e45` / `#b0342f` | `#6ccf95` / `#ff958c` | Signed values only. Always pair the colour with a sign or arrow. |
| `--heat-*` | | | Heat-map tiles and the soft gain/loss fills (`--heat-gain-soft`, `--heat-loss-soft`). |
| `--chart-2` | `#94600f` | `#e3b665` | Second series, watch star. |

Tailwind aliases (in `@theme inline`): `bg-background`, `bg-card`/`bg-surface`, `text-foreground`, `text-muted-foreground`, `bg-muted`, `text-gain`, `text-loss`, `bg-gain-soft`, `bg-loss-soft`, `border-rule`, `border-rule-mid`, `border-rule-strong`, `border-input`, `bg-primary`, `bg-secondary`.

Colour carries meaning (gain, loss, the primary action, selection). Nothing is coloured for decoration.

### Type

- **Inter** (variable) for everything. `body` sets `font-variant-numeric: tabular-nums`, so every figure aligns in columns.
- **Newsreader** (variable, `var(--display)`) only for the page title (`.view-header h1`, `.display-title`), the sign-in headline, and the occasional `.section-title`. No more than one Newsreader heading per screen region.

| Token | Size | Use |
|---|---|---|
| `--fs-2xs` | 11px | Section labels, column headers, meta, footnotes |
| `--fs-xs` | 12px | Subtitles, small controls, secondary rows |
| `--fs-sm` | 13px | **Base.** Body and data text |
| `--fs-md` | 14px | Instrument names, benchmark values |
| `--fs-lg` | 16px | `.figure-value` |
| `--fs-xl` | 20px | Portfolio totals |
| `--fs-figure` | 28px | Hero price (`.price-hero`, `.figure-lg`) |
| `--fs-display` | 44px | Page title (Newsreader) |

Uppercase labels use `letter-spacing: 0.075em` and weight 650. Tracking on large text stays between -0.015em and -0.03em.

### Space and shape

- Spacing scale: `--sp-1` 4 · `--sp-2` 8 · `--sp-3` 12 · `--sp-4` 16 · `--sp-5` 24 · `--sp-6` 32.
- `--gutter` (32px, 24px under 1220px) is the column gap between sections. `--stack` (28px, 22px under 760px) is the vertical gap between sections.
- `--row` is 30px, the data-table row height.
- Radius: **0 on sections**. Controls use 3px (`rounded-md`), chips, badges, and tags use 2px (`rounded-sm`), and popovers and dialogs use 4px (`rounded-lg`). Nothing goes above 4px. `rounded-xl` and `rounded-2xl` are clamped to 4px on purpose. `rounded-full` is for avatars and status dots only.
- Elevation: only floating layers (popover, dialog, toast, chart tooltip, mobile drawer) get `var(--shadow-pop)`, an offset soft shadow. Sections never get a shadow.

## Primitives

All live in `app/globals.css`. Use these before inventing a class. Page-specific styles go in `app/styles/*.css` and should build on these primitives.

### Section

The basic building block. It replaces the card.

```html
<section class="section">
  <header class="section-head">
    <div>
      <h2>Holdings</h2>
      <p>Valued at last trade · USD and EUR shown separately</p>
    </div>
    <div class="row-actions">
      <button data-slot="button" ...>…</button>
    </div>
  </header>
  <div class="section-body">…</div>
  <footer class="section-foot">
    <span>Source: Yahoo Finance</span><span>As of 15:42 ET</span>
  </footer>
</section>
```

- `.section` draws a 1px `--rule-strong` line on top and has no background, padding, or radius. Content aligns flush with the rule's left edge.
- `.section-head h2` is the section's label: 11px, uppercase, tracked. It is the heading itself, so never put a second heading under it.
- `.section-head p` is the subtitle in muted 12px.
- `.section-foot` / `.meta-line` is a hairline footer for source, timestamp, and currency.
- `.section-title` is a Newsreader heading for a lead section, such as the brief. Use it rarely.

**Legacy aliases.** `.panel`, `.panel-heading`, and `.panel-foot` are restyled to the same unboxed language, so existing components follow automatically. Use `.section*` in new code.

### Kicker

`.kicker` gives the same small uppercase treatment to an inline label, such as a column group or a sidebar group (`.nav-label`). It is a label in its own right. **Never stack a kicker above a heading.**

### Figures

```html
<div class="stat-row">
  <div class="figure figure-lg">
    <span class="figure-label">Book value</span>
    <strong class="figure-value">$1,284,310.22</strong>
    <span class="figure-sub">USD · 15:42 ET</span>
  </div>
  <div class="figure">
    <span class="figure-label">Day</span>
    <strong class="figure-value positive">+0.84%</strong>
  </div>
</div>
```

- `.figure` is a label, a value, and a sub-line. `.figure-lg` makes the value hero-sized.
- `.stat-row` lays figures out horizontally, separated by vertical hairlines, and wraps.
- `.num` right-aligns, uses tabular figures, and never wraps.
- Signed values use `.positive`, `.negative`, or `.neutral` (with `.change` for an inline delta plus arrow). Always include the sign.

### Data table

```html
<table class="data-table">
  <thead><tr><th>Symbol</th><th class="num">Last</th><th class="num">Chg</th><th class="num">Weight</th></tr></thead>
  <tbody>
    <tr><td class="sym">ASML</td><td class="num">€712.40</td><td class="num negative">−1.12%</td><td class="num">6.3%</td></tr>
  </tbody>
</table>
```

- 30px rows, hairline row separators, an 11px muted header over a mid rule, and no zebra striping or header fill.
- The first and last cells have no outer padding, so the table aligns with the section edge.
- The `components/ui/table.tsx` primitives (`Table`, `TableRow`, …) render the same look. Inside a `.panel` or `.section`, outer padding is stripped automatically. Put `className="text-right"` (or `num`) on numeric cells.

### Ruled list

```html
<ul class="ruled-list">
  <li>…headline… <span class="meta">Reuters · 2h</span></li>
</ul>
```

Use it for news, alerts, memories, and threads: items separated by hairlines, with no bullets and no boxes. Add `.flush-top` to draw the first rule too.

### Key–value

`<dl class="kv"><dt>P/E</dt><dd>31.4</dd>…</dl>` gives a two-column pair list with right-aligned values. For a ruled grid of stats, use `.stats-grid`.

### Chip and tag

- `.chip` is a 22px, 2px-radius filter or suggestion pill with an outline. `[aria-pressed="true"]` or `.active` inverts it to ink.
- `.tag` is a 16px uppercase label for small metadata (`13F`, `SEC`, `DEMO`).
- `Badge` (ui) supports the variants `default | secondary | outline | ghost | gain | loss | destructive | link`. It is 18px, 2px radius, 11px semibold.

### States

- `.empty` is left-aligned muted copy with a `<strong>` lead line. It has no dashed box.
- `.failure` is a loss-tinted strip with an inline retry.
- `.loading-box` with `.skeleton` children, or `.number-placeholder` inline.

## UI components (`components/ui`)

| Component | Sizes / notes |
|---|---|
| `Button` | `default` 32px · `sm` 28px · `xs` 24px · `lg` 36px · `icon` 32 · `icon-sm` 28 · `icon-xs` 24 · `icon-lg` 36. Variants: `default` (primary), `outline` (card surface, input border), `ghost`, `secondary`, `destructive` (soft loss), `link`. Radius 3px, no shadow. |
| `Input`, `Textarea` | 32px, card surface, `border-input`. Focus shows a 2px ring colour (border plus 1px outline). The text is 16px on mobile so iOS does not zoom. |
| `SelectTrigger` | `default` 32px, `sm` 28px. Content is a 4px popover with `--shadow-pop` and 28px items. |
| `Tabs` | `default` is a segmented control on a `--muted` track. `line` gives text tabs with a 2px ink underline that sits on the rule below (put the list in `.tabs-bar`, or the list draws its own rule in `.workspace-tabs`). |
| `Dialog` | 4px radius, card surface, 20px padding, left-aligned header, a 24px close button. |
| `Table` | See Data table. |

Focus: every interactive element shows a 2px `--ring` outline at 2px offset (`:focus-visible`, set in base). Do not remove it.

## Do

- Separate sections with `--stack` / `--gutter` whitespace plus the top rule.
- Align content flush to the section's left edge, with no inner horizontal padding.
- Put a source, timestamp, and currency line under every number block (`.section-foot` / `.meta`).
- Keep totals per currency. Never sum across currencies.
- Use tabular figures (default) and right-align numeric columns.
- Use 13px for data. Go smaller only for labels and meta, never for primary values.
- Keep hover feedback quiet: a `--muted` fill on rows and a border darken on controls.

## Don't

- Don't wrap a section in a border, background, radius, and shadow. That is the card we removed.
- Don't nest anything box-like inside a section. Use hairlines.
- Don't use a radius above 4px, pill buttons, or `rounded-full` on anything but avatars and dots.
- Don't use a colored `border-left` accent on list items, alerts, or callouts.
- Don't add gradient text, glass or blur, or decorative colour.
- Don't put a kicker or eyebrow above a heading, or number the sections.
- Don't put a hero metric in a tile with a big number, a small label, and an accent. Use `.figure` inside a `.stat-row`.
- Don't use raw hex colours or new grey values. Use tokens.
- Don't use Newsreader for data, labels, or more than one heading per region.

## Responsive

- Under 1100px the assistant column stacks above the result. Under 980px the sidebar becomes a drawer. Under 760px every grid collapses to one column, benchmarks wrap to three per row, and the page side gutter is 16px. Under 480px the topbar collapses to icons.
- Wide tables scroll inside their own container (`[data-slot="table-container"]` is `overflow-x: auto`). The page never scrolls horizontally.
