---
name: use-envoy
description: Operate the Envoy (`envy`) Git-like CLI to initialize projects, stage encrypted environment files, inspect redacted diffs, commit, synchronize remotes, apply deletions, manage project and per-file member access, restore current or legacy files, diagnose projects, and authenticate. Use when an agent must manage encrypted environment files or automate Envoy commands without interactive prompts.
---

# Use Envoy

Run `envy` from the project directory. Prefer arguments for non-secret values and named piped input for passphrases.

For authenticated CI or agent runs, provide the Envoy API token through
`ENVOY_API_TOKEN`. Keep passphrases separate and pipe them through stdin. Never
write either value to logs, command arguments, artifacts, or cache keys.

## Supply input non-interactively

Pass ordinary values with the command's documented arguments:

```text
envy add --input .env.production --passphrase <project-passphrase>
envy commit --message "Update production configuration" --author agent --passphrase <project-passphrase>
```

For secrets, send UTF-8, newline-delimited `key=value` records to stdin:

```text
input=.env.production
passphrase=<passphrase>
```

Pipe those records to the command. Apply these rules:

- Let command-line arguments override matching piped values.
- Put one record on each line.
- Use the first `=` as the separator; preserve later `=` characters in the value.
- Use exact lowercase keys from the command matrix.
- Expect unknown named keys to fail instead of being ignored.
- Avoid passphrases in arguments when shell history or process listings are visible.
- Do not print, log, or commit passphrases.

Plain, unnamed lines remain positional fallbacks for compatibility. Prefer named records because they are deterministic.

## Choose command inputs

| Command | Arguments | Piped keys |
| --- | --- | --- |
| `envy init` | `--name`, `--passphrase` | `name`, `passphrase` |
| `envy add` | positional `FILE`, `--input`, `--passphrase` | `input`, `passphrase` |
| `envy encrypt` (legacy) | positional `FILE`, `--input`, `--passphrase` | `input`, `passphrase` |
| `envy remove` / `envy rm` | positional `FILE`, `--input`, `--passphrase`, `--cached` | `input`, `passphrase` |
| `envy commit` | `--message`, `--author`, `--passphrase` | `message`, `author`, `passphrase` |
| `envy log` | `--count`, `--passphrase` | `count`, `passphrase` |
| `envy status` | `--passphrase` | `passphrase` |
| `envy diff` | `--cached`, `--show-secrets`, `--passphrase` | `passphrase` |
| `envy push` | positional `REMOTE`, `--passphrase` | `remote`, `passphrase` |
| `envy pull` | positional `REMOTE`, password options below | `remote`, `passphrase`, file mappings below |
| `envy doctor` | positional `REMOTE`, `--passphrase` | `remote`, `passphrase` |
| `envy remote add` | positional `NAME URL` | `name`, `url` |
| `envy member add` | positional `GITHUB`, `--nickname` | `github`, `nickname` |
| `envy member remove` | positional `USER_ID` | `user_id` |
| `envy access grant/revoke` | positional `FILE USER_ID`, `--passphrase` | `input`, `user_id`, `passphrase` |
| `envy access list/unrestrict` | positional `FILE`, `--passphrase` | `input`, `passphrase` |

Commands without inputs are `login`, `logout`, `update`, `member list`, and `member remove-all`. Expect `login` and an unauthenticated `init` to require GitHub device authorization outside stdin.

## Stage and inspect safely

Use `envy add` for new and changed files. It derives an independent file key
from the one project passphrase. `envy encrypt` is retained for legacy
per-file-passphrase workflows.

Run `envy diff` for unstaged working-tree changes and `envy diff --cached` for
staged changes. Values are redacted by default. Do not use `--show-secrets`
unless plaintext terminal output is explicitly acceptable.

`envy rm FILE` deletes the working file and stages its deletion. Use
`envy rm --cached FILE` to keep the working file. Pull also applies committed
deletions and refuses to overwrite a locally modified managed file.

## Restore files

Managed files require only the project passphrase:

```text
envy pull --passphrase <project-passphrase>
```

Treat the project passphrase and legacy file passphrases as separate values.

For one legacy file passphrase shared by all legacy files, use:

```text
envy pull --passphrase <project-passphrase> --file-passphrase-all <file-passphrase>
```

For different legacy file passphrases, repeat an explicit mapping:

```text
envy pull --passphrase <project-passphrase> \
  --file-passphrase ".env=<first-passphrase>" \
  --file-passphrase ".env.production=<second-passphrase>"
```

Prefer named stdin for automation:

```text
passphrase=<project-passphrase>
file:.env=<first-passphrase>
file:.env.production=<second-passphrase>
```

Use `file:*=<file-passphrase>` for one shared file passphrase. Use `file:<normalized-path>=skip` to skip a file deliberately. Never pass different file passphrases by order: manifest iteration and retry subsets do not have a stable positional order.

## Manage file access

Use user IDs from `envy member list`. The first grant creates an allowlist; an
empty allowlist is owner-only. Revoke requires an existing allowlist.
`unrestrict` restores project-wide member downloads. Commit and push every
access change. Grants do not revoke ciphertext a member downloaded earlier.

## Follow the normal workflow

1. Run `envy login` when authentication is absent.
2. Run `envy init` once.
3. Run `envy add` for each file to stage.
4. Run `envy status` and `envy diff --cached`.
5. Run `envy commit --message <message>`.
6. Run `envy push`.
7. On another machine, run `envy pull --passphrase <project-passphrase>`.

Run `envy doctor` when local cache, manifest, commit history, or remote synchronization appears inconsistent.

Set `ENVOY_NO_UPDATE_CHECK=1` in isolated tests or offline automation.
Set `ENVOY_HOME` to isolate global tokens and sessions in test environments.
