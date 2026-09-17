# deniz auth — design as built

What the app looks like and why, read off the code on branch
`feat/auth-ui-overhaul`. Product truth is `PRODUCT.md`; the direction
contract is `docs/internal/plans/024-auth-ui-overhaul.md`.

## Where things live

- `packages/auth-ui` (`@repo/auth-ui`) — the flow: brand mark, flow frame,
  step primitives, the step screens, the step transition, the destination
  and user-agent helpers, `flow.css`. Presentational components with props
  and callbacks; no fetching.
- `apps/auth` — the pages that wire those to the API, and the management
  shell (`components/shell-frame.tsx`, `session-gate.tsx`, `shell.tsx`).
- `@repo/ui` — every control (button, input, input-otp, checkbox, radio,
  alert, badge, table, sheet, dialog, alert-dialog via confirm-button,
  dropdown-menu, avatar, skeleton, spinner, copy-button).
- `@repo/cloud-ui` — theme provider and toggle, `usePoll`, `format`,
  `api-client`. Nothing in it changed.

## Tokens

All colour comes from `packages/ui/src/theme.css`; the app adds no palette.
How each token is used here:

| Token | Used for |
|---|---|
| `--background` | page |
| `--accent-strong` | headings, names, the mark's outline and shadow, caret; the "ink" |
| `--foreground` | body text and values |
| `--muted-foreground` | labels, secondary lines, table meta, text actions at rest |
| `--accent` | the mark's body, light-mode selection fill |
| `--surface` | active nav item, avatar fallback, selected radio option |
| `--border` | every hairline (sections, rows, tables, the destination line) |
| `--primary` / `--primary-foreground` | the one primary button per screen, `accent-color` |
| `--destructive` | error text and the error alert's icon |
| `--ring` | focus ring (`ring-[3px] ring-ring/50`) on every control |

Two app-scoped rules in `app/globals.css`:

- **Dark `--destructive` is overridden to `#f2a48f`.** The shared value
  (`#a04033`) is a fill colour: as text on the dark background and card it
  measures 1.9:1 and 1.5:1. This app shows errors as text, so it lifts the
  value to 6.2:1 / 4.9:1 and keeps the hue. Worth fixing upstream in
  `theme.css` with a separate text token.
- Browser surfaces take the palette: `color-scheme` follows the theme,
  `accent-color: var(--primary)`, `caret-color: var(--accent-strong)`,
  `::selection` is accent on accent-strong in light and muted on foreground
  in dark (both ≥ 6:1), tables get `tabular-nums`.

Contrast facts that shaped choices: light `--foreground` on `--background`
is 4.65:1, but on `--surface` 4.4:1 and on `--muted` 3.4:1 — so body-size
text never sits on a surface or muted fill; badges are the `outline`
variant (text on background), the active nav item uses `accent-strong` on
`surface` (≈ 12:1). In light mode `--muted-foreground` is darker than
`--foreground`; the hierarchy is carried by size and weight, not by the
muted colour alone.

## Type

One family, Geist Sans; Geist Mono only for codes, keys, ids, hosts, IPs and
transports. Fixed rem scale, steps of about 1.2:

| Step | Where |
|---|---|
| `text-2xl` semibold, `tracking-tight` (−0.025em) | the flow question (h1) |
| `text-xl` semibold, `tracking-tight` | management page title |
| `text-lg` | OTP slot digits |
| `text-base` (16 px) | every flow control, on every breakpoint — no zoom on iOS |
| `text-sm` | body, labels, table cells, buttons, section titles (semibold) |
| `text-xs` | meta: destination line, table meta, hints, inline errors |

No kicker labels, no uppercase tracking. Headings are `text-accent-strong`.

## Spacing rhythm

Tailwind's 4 px scale. The flow column: heading block → 32 (`gap-8`) → form;
inside the form 20 (`gap-5`) between field, checkbox, button and the text
actions; label → control 8. Management: page intro → 32 → section → 32 →
section; section header → 16 → content; rows are 10–12 px vertical padding
on a hairline. The strip is 56 px tall (`h-14`). Horizontal padding is 20 px
on phones and 32 px from `sm`.

Column widths: the flow column is `max-w-[26rem]`; the management column
`max-w-5xl` (64 rem).

## The flow frame

`FlowFrame` (`flow-frame.tsx`): a column layout of three parts.

1. Strip: `Brand` (mark + wordmark, not a link — leaving mid-flow is not a
   thing the mark should offer) and the theme toggle, `justify-between`.
2. Main: `flex-1`, the step vertically and horizontally centred in the
   26 rem column. The column carries `.auth-flow-step`, the only element
   with a `view-transition-name`.
3. Footer: the destination line under a hairline, pinned to the bottom of
   the page at the same column width. It reads "Continuing to **Forge** ·
   `forge.denizlg24.com`". `destination` is a `Destination`, `"pending"`
   (a skeleton line while an OAuth client's name resolves) or `null`
   ("deniz auth").

No card, no border around the column, no shadow anywhere on flow screens.

### Step screens

Each is one component with a heading, an optional alert, a form and the
alternatives as text actions:

- `UsernameStep` — "Who's signing in?"; `autocomplete="username webauthn"`
  when a passkey handler is given; Continue; "Use a passkey instead";
  "Have an invitation?".
- `PasswordStep` — "Welcome back, {username}" with "Not you?" as the
  heading's aside; a visually hidden read-only `username` input so password
  managers pair the fields; "Remember me on this device" (default on).
- `SecondFactorStep` — six OTP slots that submit on the sixth digit, or a
  mono backup-code field; "Trust this device — skip the code here next
  time" (default off); "Use a backup code instead"; Back.
- `TotpEnrollment` — two phases inside one component with cloud-ui's API
  contract (`authClient`, `password`, `onVerified`, `onFailed`): scan (QR at
  224 px, rendered at 2× in the palette's ink and paper, the key in mono
  with a copy button) then verify (OTP slots). The enable call runs once
  per password; `qrcode` is imported lazily.
- `BackupCodesStep` — the codes in a two-column mono grid, Copy and
  Download side by side, then "I've saved them".
- `InvitationStep` — the one multi-field screen: code, username, email,
  password with the minimum-length hint.
- `ConsentStep` — "Allow {client} to use your account?"; the client as
  avatar + name + homepage host; a notice when it registered itself; a
  `<dl>` of "It can reach" (resources by name, host in mono), "It can"
  (scopes as one-line meanings, raw scope in mono) and "As" (username,
  "Not you? Sign out"); Allow and Deny side by side.
- `CheckingStep` — a skeleton in the shape of heading + field + button.
- `FlowMessage` — a heading and one line for passing-through screens
  (signing in, signing out, forbidden).

### Step primitives (`flow-step.tsx`)

`StepHeading` (h1 + lede + aside), `StepAlert` (`@repo/ui/alert`, `error`
or `notice` tone, lucide `CircleAlert` / `Info`), `StepForm`, `FlowField`
(label, control, inline error or hint), `StepButton` (full width, 44 px,
16 px type, spinner while busy, label kept so nothing shifts), `TextAction`
(text-only secondary action with hover underline and a focus ring),
`StepActions`, and `flowControlClass` (`h-11 text-base`) for inputs.

## The step transition

`transitionStep(update)` (`flow-transition.ts`) runs the state change inside
`document.startViewTransition`, committing with `flushSync` so the new
snapshot is the new step. `flow.css` animates the named group: the old step
fades and moves up 8 px over 150 ms, the new one fades and rises 8 px into
place over 200 ms, both on `cubic-bezier(0.16, 1, 0.3, 1)`. The root's own
snapshots are set to `animation: none`, which is what keeps the strip and
the destination line still. Browsers without the API and users with
`prefers-reduced-motion` get a plain cut. Every step change on the login
page and the enrollment's scan → verify go through it; state that belongs
to the change (the error, the busy flag) is updated inside the same call so
it never paints on the outgoing step.

## The mark

`BrandMark` (`brand.tsx`) is an inline SVG of the pixel padlock, a 12 × 12
grid of `<rect>`s with `shape-rendering="crispEdges"`. Fills are
`var(--accent-strong)` for outline and drop shadow and `var(--accent)` for
the body, so it themes: deep green on sage in light, cream on sage in dark.
The grid was read from `app/icon.png` at 16 cells (the icon is 512 px on a
~32 px grid); the source's cells are jittered by up to a third of a cell and
its shackle sits half a cell right of the body's axis, so the SVG is the
regularised symmetric reading — same three-step arch, three-cell hole,
keyhole and one-cell shadow with the notched corner — not a pixel trace.
Rendered at 24 px in both strips. `Wordmark` is "deniz" in
`accent-strong` and "auth" in `muted-foreground`, semibold, matching the
sibling apps. `public/auth_logo.png` was deleted; the favicon and Apple icon
stay rasters.

## Management shell

`ShellFrame`: a strip with the brand (a link home), the section nav
(Account · Security · Clients; active item on `surface` in `accent-strong`
with `aria-current`), the theme toggle and the account menu (avatar initial,
username from `sm`, a dropdown with username/email and Sign out). Under
`sm` the nav drops to a second row. Content sits in a 64 rem column.

Page pattern: `PageIntro` (title, one line, actions) over a hairline; then
`PageSection`s (title, count in muted tabular figures, actions) over a
hairline; `SectionEmpty` says what the section is for and offers the action.

Tables use `@repo/ui/table` from `sm` up; under `sm` passkeys and sessions
render as stacked rows (`StackedRow`: title with badge, one meta line,
actions) and the clients table keeps only Name, Kind and Status. Client
detail is a right-side `Sheet` with a `<dl>` and the actions in its footer;
the sheet reads its row from the latest list so an action's result shows
without a stale copy. Create and credentials are `Dialog`s; the kind is a
radio group with a one-line meaning per option. Confirmations are
`ConfirmButton` (alert dialog) with copy that names the consequence.

Loading is always content-shaped `Skeleton`s (`PageSkeleton`,
`SectionSkeleton`, `CheckingStep`); spinners appear only inside a busy
button. Errors at page level are `text-destructive` with a "Try again";
field errors sit under the field with `role="alert"`; toasts (sonner) only
for row actions that have no other surface.

## Component states

Every control is a `@repo/ui` primitive and inherits its default, hover,
focus-visible (3 px ring at 50 % of `--ring`), active, disabled (50 %
opacity, no pointer) and invalid (`aria-invalid` → destructive border) states.
Added here: busy buttons (`aria-busy`, spinner, label kept), OTP slots with
`aria-invalid` on error, rows with `hover:bg-surface`, nav items with
`aria-current`, text actions with hover underline.

## Motion rules

- 150–250 ms, ease-out, state conveyance only: the step transition, colour
  transitions on hover, the sheet/dialog enter/exit from `@repo/ui`.
- No page-load choreography; skeletons pulse, nothing else animates on its
  own.
- `prefers-reduced-motion` turns the step transition into a cut.

## Dark theme notes

- `.dark` from `theme.css` inverts emphasis: `--accent-strong` becomes cream
  (the mark's outline, headings), `--primary` becomes sage with deep-green
  text (6:1).
- Error text uses the app-scoped `--destructive` (see Tokens).
- The QR code is drawn with its own paper colour inside the image, so it
  scans on the dark page.
- `color-scheme: dark` makes native scrollbars, selects and date pickers
  match.
- Selection is `--muted` on `--foreground` (6.2:1); the light pair would be
  1.9:1 in dark.
