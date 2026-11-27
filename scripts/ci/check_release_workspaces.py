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
        for root_input in ("bun.lock", "package.json"):
            if f'"{root_input}"' not in release:
                errors.append(f"{workflow}: changes to {root_input} do not trigger a release")
        for dependency in sorted(closure(name, catalog, include_dev=False)):
            directory, _ = catalog[dependency]
            if f'"{directory}/**"' not in release:
                errors.append(f"{workflow}: changes to {directory} do not trigger a release")
    for workspace, (dockerfile, _) in SERVICES.items():
        name = json.loads((ROOT / workspace / "package.json").read_text())["name"]
        docker = (ROOT / dockerfile).read_text()
        # turbo prune stages exactly the workspace closure, so the image can
        # only miss a dependency if the install or build skips the pruned
        # output. scripts/verify-docker-prune.sh checks the install resolves.
        for line in (
            f"RUN turbo prune {name} --docker\n",
            "COPY --from=prune /workspace/out/json/ ./\n",
            "bun install --frozen-lockfile",
            "COPY --from=prune /workspace/out/full/ ./\n",
        ):
            if line not in docker:
                errors.append(f"{dockerfile}: expected `{line.strip()}`")
    return errors


if __name__ == "__main__":
    problems = check()
    if problems:
        raise SystemExit("\n".join(problems))
    print("Release workspace dependencies, Docker inputs, and path filters are aligned")
