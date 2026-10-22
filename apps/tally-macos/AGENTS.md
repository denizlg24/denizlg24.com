# Tally (apps/tally-macos)

Native macOS menu-bar app (SwiftUI, macOS 26, Swift 6 strict concurrency)
tracking Claude seat usage and switching seats, Codex limits, denizlg24.com's
LLM spend, and local Claude Code / Codex token use. Owner-only: the root
CLAUDE.md copy rules apply (no explanatory copy, data-dense).

## Build

The Xcode project is generated, never committed: `brew install xcodegen`, then
`xcodegen generate` in this directory after changing `project.yml` or adding a
file. `xcodebuild -scheme Tally -derivedDataPath build/dd test` runs the tests;
`TEST_RUNNER_TALLY_SNAPSHOT_DIR=/tmp/tally xcodebuild … test` also renders
the dashboard and menu against this Mac's live data as PNGs (buttons and
spinners come out as placeholders — `ImageRenderer` cannot draw AppKit
controls). The icon is `scripts/render-icon.swift`.

## Releasing

`bun run bump:tally <patch|minor|major>` at the repo root bumps
`MARKETING_VERSION` in `project.yml` and opens a `CHANGELOG.md` entry. A
version change on `main` runs `release-tally.yml`: Developer ID signing,
notarization, a stapled zip on a `tally-v<version>` release whose notes are
the changelog entry plus the PRs that touched this directory. Releases are
never "latest": the Envoy CLI's updater reads this repository's latest release.
Signing material comes from the `desktop-release` environment, shared with
the desktop app.

## What bites

- **Claude credentials use native keychain access.** Background reads and writes
  disable interaction with the serialized legacy keychain interaction setting
  as well as `LAContext.interactionNotAllowed` (the login keychain ignores the
  latter). Only an explicit seat switch may ask for access. Never invoke
  `security` from polling: its access dialogs can
  repeat indefinitely. Never use `security -i` for credentials: its 4,096-byte
  line limit truncates hex payloads above roughly 2 KB. Never pass tokens in
  process arguments. Verify each write by reading the full document back.
- **The item holds more than the seat.** `mcpOAuth` (every MCP server's
  tokens) sits beside `claudeAiOauth`. A switch replaces `claudeAiOauth` and
  `~/.claude.json`'s `oauthAccount` and nothing else.
- **Token ownership follows the switch.** The active seat's family belongs to
  Claude Code: Tally copies it every 30 s and never refreshes it (a rotation
  would strand Claude Code's copy; an expired active token just shows the last
  reading). Inactive seats belong to Tally, which refreshes them to poll usage.
  The 30 s copy is what keeps a seat's tokens current before `claude auth
  login` overwrites them with another seat's.
- **A session started on the old seat can write it back.** When a running
  Claude Code session refreshes its seat after a switch, the keychain flips
  back. Tally captures those tokens and restores the seat chosen in Tally. An
  unknown account appearing in the keychain is a new sign-in and is adopted.
- **Codex's token is never refreshed here** — the Codex CLI owns it. A failed
  live read falls back to the newest `rate_limits` in `~/.codex/sessions`.
- **Claude Code writes one log line per content block**, each carrying the
  whole message's usage; the scanner counts a `message.id:requestId` once.
  Codex reports a running session total, so a turn's spend is the change.
- **denizlg24 sign-in reuses the desktop's `native` client** discovered from
  `/api/public/desktop-auth`; Cloudflare refuses requests without a real
  User-Agent, which is why `HTTP.session` sets one.
