#!/usr/bin/env bash
# Every Dockerfile that runs `turbo prune <targets> --docker` installs from the
# pruned bun.lock, and turbo has emitted lockfiles bun refuses (a dropped
# transitive entry). This reproduces that install step without Docker so a
# lockfile change that breaks a prune fails here instead of in a deploy.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
status=0

for dockerfile in "$root"/apps/*/Dockerfile "$root"/apps/*/Dockerfile.*; do
  [ -f "$dockerfile" ] || continue
  line="$(grep -E '^RUN turbo prune ' "$dockerfile" || true)"
  [ -n "$line" ] || continue
  targets="$(sed -E 's/^RUN turbo prune (.*) --docker$/\1/' <<<"$line")"
  version="$(sed -nE 's/^RUN bun add --global turbo@(.*)$/\1/p' "$dockerfile")"
  out="$scratch/$(basename "$(dirname "$dockerfile")")-$(basename "$dockerfile")"

  # shellcheck disable=SC2086
  (cd "$root" && bunx "turbo@$version" prune $targets --docker --out-dir "$out" >/dev/null 2>&1)
  if (cd "$out/json" && bun install --frozen-lockfile --ignore-scripts --dry-run >/dev/null 2>&1); then
    echo "ok    ${dockerfile#"$root"/} ($targets)"
  else
    echo "FAIL  ${dockerfile#"$root"/} ($targets)"
    status=1
  fi
done

exit "$status"
