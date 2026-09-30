#!/usr/bin/env python3
"""Keep Docker build inputs and release paths aligned with workspace dependencies."""

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SERVICES = {
    "apps/api": ("apps/api/Dockerfile", ".github/workflows/release-cloud.yml"),
    "apps/markets-relay": ("apps/markets-relay/Dockerfile", ".github/workflows/release-markets-relay.yml"),
}
RELEASES = {
    "apps/api": ".github/workflows/release-cloud.yml",
    "apps/markets-relay": ".github/workflows/release-markets-relay.yml",
    "apps/terminal": ".github/workflows/release-cloud-terminal.yml",
    "apps/storage-metadata": ".github/workflows/release-cloud-terminal.yml",
    "apps/deploy-agent": ".github/workflows/release-deploy-agent.yml",
}


def workspaces() -> dict[str, tuple[str, dict]]:
    result = {}
    for group in ("apps", "packages"):
        for manifest in (ROOT / group).glob("*/package.json"):
            package = json.loads(manifest.read_text())
            result[package["name"]] = (str(manifest.parent.relative_to(ROOT)), package)
    return result


def closure(start: str, catalog: dict[str, tuple[str, dict]], include_dev: bool) -> set[str]:
    pending = [start]
    found = set()
    while pending:
        name = pending.pop()
        if name in found:
            continue
        found.add(name)
        _, package = catalog[name]
        fields = ("dependencies", "optionalDependencies", "devDependencies") if include_dev else ("dependencies", "optionalDependencies")
        for field in fields:
            for dependency, version in package.get(field, {}).items():
                if version.startswith("workspace:"):
                    if dependency not in catalog:
                        raise ValueError(f"{name} references missing workspace {dependency}")
                    pending.append(dependency)
    return found


def check() -> list[str]:
    catalog = workspaces()
    errors = []
    for workspace, workflow in RELEASES.items():
        name = json.loads((ROOT / workspace / "package.json").read_text())["name"]
        release = (ROOT / workflow).read_text()
        for dependency in sorted(closure(name, catalog, include_dev=False)):
            directory, _ = catalog[dependency]
            if f'"{directory}/**"' not in release:
                errors.append(f"{workflow}: changes to {directory} do not trigger a release")
    for workspace, (dockerfile, _) in SERVICES.items():
        name = json.loads((ROOT / workspace / "package.json").read_text())["name"]
        docker = (ROOT / dockerfile).read_text()
        # The pinned Bun 1.3.3 image cannot reliably do a frozen install with
        # missing workspace manifests, even when --filter selects one app.
        for dependency in sorted(catalog):
            directory, _ = catalog[dependency]
            copy = f"COPY {directory}/package.json {directory}/package.json"
            if copy not in docker:
                errors.append(f"{dockerfile}: missing {copy}")
        for dependency in sorted(closure(name, catalog, include_dev=False)):
            directory, _ = catalog[dependency]
            copy = f"COPY {directory} {directory}"
            if copy not in docker:
                errors.append(f"{dockerfile}: missing {copy}")
    return errors


if __name__ == "__main__":
    problems = check()
    if problems:
        raise SystemExit("\n".join(problems))
    print("Release workspace dependencies, Docker inputs, and path filters are aligned")
