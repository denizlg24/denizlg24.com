#!/usr/bin/env python3
"""Guarded offsite retention. Never consults the protected host's local data."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import sys
import tempfile

from r2_catalog import Catalog, ROOT, UTC, run, timestamp

POLICY = ["--group-by", "host", "--keep-last", "3", "--keep-within", "14d",
          "--keep-daily", "90", "--keep-monthly", "12"]


def guarded_plan(snapshots, groups, now, max_delete_percent=25):
    if not snapshots:
        raise ValueError("empty repository; refusing retention")
    by_id = {s["id"]: s for s in snapshots}
    times = [timestamp(s["time"]) for s in snapshots]
    if max(times) > now + dt.timedelta(minutes=5):
        raise ValueError("future snapshot; refusing retention")
    if now - max(times) > dt.timedelta(hours=36):
        raise ValueError("no offsite snapshot in 36 hours; refusing retention")
    keep, remove = set(), set()
    for group in groups:
        keep.update(s["id"] for s in group.get("keep") or [])
        remove.update(s["id"] for s in group.get("remove") or [])
    if keep & remove or keep | remove != set(by_id):
        raise ValueError("retention preview does not partition the exact repository")
    if len(keep) < min(3, len(snapshots)):
        raise ValueError("retention must preserve at least three snapshots")
    if any(now - timestamp(by_id[s]["time"]) <= dt.timedelta(days=14) for s in remove):
        raise ValueError("retention would delete a snapshot in the 14-day safety window")
    if len(remove) * 100 > len(snapshots) * max_delete_percent:
        raise ValueError("retention exceeds the reviewed deletion percentage limit")
    return sorted(keep), sorted(remove)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("pi", "forge"), required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.execute and args.check_only:
        parser.error("choose --execute or --check-only")
    maximum = int(os.environ.get("DR_R2_MAX_DELETE_PERCENT", "25"))
    if not 1 <= maximum <= 50:
        raise ValueError("DR_R2_MAX_DELETE_PERCENT must be 1..50")
    with tempfile.TemporaryDirectory(prefix="dr-r2-retention-") as work:
        catalog = Catalog(args.profile, work, no_cache=False).load()
        groups = catalog.restic_json("forget", "--dry-run", "--json", "--no-lock", *POLICY)
        now = dt.datetime.now(UTC)
        keep, remove = guarded_plan(catalog.snapshots, groups, now, maximum)
        authenticated = {i["snapshot"]["id"] for i in catalog.ready.values()}
        if not set(keep).issubset(authenticated):
            raise ValueError("a retained snapshot has no signed READY; refusing retention")
        # The newest usable point must contain the manifest authenticated by
        # READY, not just a snapshot object whose data is absent.
        latest = max(catalog.ready.values(), key=lambda i: i["created"])
        catalog.manifest(latest)
        result = {"writes": args.execute, "policy": POLICY, "host": catalog.host,
                  "keep": keep, "remove": remove, "snapshotCount": len(catalog.snapshots),
                  "maxDeletePercent": maximum, "manifestDeletes": []}
        # Obsolete manifests from an interrupted previous forget are healed
        # here. Their signatures still have to verify and the safety window
        # still applies. No arbitrary prefix/object deletion is supported.
        obsolete = [i for i in catalog.ready.values() if i["snapshot"]["id"] in remove] + catalog.missing
        obsolete = [i for i in obsolete if now - timestamp(i["ready"]["createdAt"]) > dt.timedelta(days=14)]
        result["manifestDeletes"] = [i["key"] for i in obsolete]
        if args.execute:
            catalog.restic("check")
            current = catalog.restic_json("snapshots", "--json", "--no-lock")
            if {s["id"] for s in current} != {s["id"] for s in catalog.snapshots}:
                raise ValueError("repository changed during retention planning; retry next cycle")
            if remove:
                catalog.restic("forget", *remove)
            # Always prune so a failure between forget/prune heals next week.
            # Restic owns pack reachability and its exclusive repository lock.
            catalog.restic("prune", "--max-unused", "5%", "--max-repack-size", "1G")
            catalog.restic("check")
            remaining = {s["id"] for s in catalog.restic_json("snapshots", "--json", "--no-lock")}
            if not set(keep).issubset(remaining) or set(remove) & remaining:
                raise ValueError("post-retention snapshot verification failed")
            for item in obsolete:
                for key in (item["key"], item["key"] + ".sig"):
                    run([str(ROOT / "lib/r2-object"), "delete-ready", key], env=catalog.env)
            result["verified"] = True
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, RuntimeError, KeyError, OSError) as error:
        sys.exit(f"STOP: {error}")
