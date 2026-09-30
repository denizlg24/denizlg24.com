#!/usr/bin/env python3
"""Select independent CI jobs from NUL-delimited paths supplied by git diff."""

import sys


def select(paths: list[str]) -> dict[str, bool]:
    checks = {"build": False, "macros_db": False, "macros_vision": False, "envoy_cli": False, "workflow_lint": False}
    for path in paths:
        if path.startswith((".github/workflows/", ".github/actions/")):
            checks["workflow_lint"] = True
        if path == ".github/workflows/ci.yml":
            for name in ("build", "macros_db", "macros_vision", "envoy_cli"):
                checks[name] = True
            continue
        if path in {"bun.lock", "package.json"}:
            checks["build"] = True
            checks["macros_db"] = True
            continue
        if path.startswith("apps/macros-vision/"):
            checks["macros_vision"] = True
        elif path.startswith("apps/envoy-cli/"):
            checks["envoy_cli"] = True
        elif path.startswith("apps/") or path.startswith("packages/"):
            checks["build"] = True

        if path.startswith(("apps/macros/db/", "apps/macros/drizzle/")) or path == "apps/macros/drizzle.config.ts":
            checks["macros_db"] = True
        if path.startswith("scripts/") or path in {"turbo.json", "biome.json", "biome.jsonc", "tsconfig.json"}:
            checks["build"] = True
    return checks


if __name__ == "__main__":
    paths = [path.decode() for path in sys.stdin.buffer.read().split(b"\0") if path]
    for name, enabled in select(paths).items():
        print(f"{name}={str(enabled).lower()}")
