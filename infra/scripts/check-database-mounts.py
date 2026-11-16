#!/usr/bin/env python3
"""Reject a release that would attach existing databases to different data."""

import json
import os
import subprocess
import sys


DATA_TARGETS = {
    "postgres": "/var/lib/postgresql/data",
    "mongodb": "/data/db",
    "redis": "/data",
    "meilisearch": "/meili_data",
    "mongot": "/data/mongot",
}


def validate(config, containers):
    checked = 0
    for service, target in DATA_TARGETS.items():
        spec = config["services"].get(service)
        if spec is None:
            continue
        volumes = [v for v in spec.get("volumes", []) if v.get("target") == target]
        if len(volumes) != 1 or volumes[0].get("type") != "bind":
            raise ValueError(f"{service}: expected exactly one database bind mount")
        current = containers.get(service, [])
        if not current:
            raise ValueError(f"{service}: no existing database container to verify")
        expected = os.path.realpath(volumes[0]["source"])
        for container in current:
            mounts = [m for m in container.get("Mounts", []) if m.get("Destination") == target]
            if (len(mounts) != 1 or mounts[0].get("Type") != "bind"
                    or os.path.realpath(mounts[0]["Source"]) != expected):
                raise ValueError(f"{service}: release would change the database data mount; refusing deployment")
        checked += 1
    if not checked:
        raise ValueError("no database data mounts were verified")
    return checked


def main(args):
    compose = ["docker", "compose", *args]
    config = json.loads(subprocess.check_output([*compose, "config", "--format", "json"]))
    containers = {}
    for service in DATA_TARGETS:
        if service not in config["services"]:
            continue
        ids = subprocess.check_output([*compose, "ps", "-a", "-q", service], text=True).split()
        containers[service] = json.loads(subprocess.check_output(["docker", "inspect", *ids])) if ids else []
    count = validate(config, containers)
    print(f"Verified unchanged data mounts for {count} database services")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"STOP: database mount verification failed: {error}", file=sys.stderr)
        sys.exit(1)
