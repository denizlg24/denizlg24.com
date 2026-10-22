# Changelog

What changed in each Tally release, newest first. The GitHub release for a
version opens with its entry. Each release is a `## <version> — <YYYY-MM-DD>`
heading, optionally grouped under `### Added`, `### Changed`, `### Fixed`.
`bun run bump:tally <patch|minor|major>` opens the entry for the next version.

## 0.1.1 — 2026-10-22

### Fixed
- Preserve Claude Code's Apple-tool keychain access during seat switches, so
  its credential reads stop requesting a password after Tally refreshes.
- Handle Unicode credentials and reject oversized writes before changing data.
- Allow explicit authorization of seats saved by a development build while
  keeping background refreshes silent.

## 0.1.0 — 2026-10-22

### Added
- Claude seats: 5-hour and weekly usage for every seat signed in on this Mac,
  read from the same endpoint as Claude Code's `/usage`, with a tick on each
  bar marking how far through its window the clock is.
- Seat switching from the menu bar, the dashboard, Shortcuts and Spotlight
  ("Switch Claude Seat", "Switch to Freshest Claude Seat"), and from the
  notification raised when the active seat crosses its limit threshold.
  Only Claude Code's `claudeAiOauth` and `oauthAccount` change; MCP server
  tokens in the same keychain item are kept.
- New seats are adopted on their own after `claude auth login` (Add Seat
  opens it in Terminal).
- Codex: 5-hour and weekly limits from the ChatGPT usage endpoint, falling
  back to the newest `rate_limits` in the session logs.
- denizlg24: LLM spend for 24 hours, 7 days, 30 days and all time, the daily
  cost chart, cost by model and by source, and the latest calls, signed in
  through the desktop app's native OAuth client.
- Local tokens: 14 days of Claude Code and Codex token use read from their
  session logs — per day, per model, and per Claude seat.
