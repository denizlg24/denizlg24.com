#!/usr/bin/env python3
"""Metadata-only recovery rehearsal, also used to select real R2 recoveries."""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

from r2_catalog import Catalog, UTC, select, timestamp
from recovery_packages import resolve, policy_hash


def plan(catalogs, items, mode):
    snapshots = []
    package_inventories = []
    version_hash = None
    controls = None
    blockers = []
    for item in items:
        catalog = catalogs[item["ready"]["profile"]]
        manifest = catalog.manifest(item)
        # These two files are small and determine whether the real bootstrap
        # would accept the pair. Bind both to the signed artifact inventory.
        metadata = {}
        for name in ("meta/versions.lock.json", "meta/host-packages.json"):
            payload = catalog.restic("dump", "--no-lock", item["snapshot"]["id"], "/" + name)
            if len(payload) > 1024 * 1024:
                raise ValueError("metadata file exceeds 1 MiB")
            if name.endswith("host-packages.json") and manifest.get("hostPackagesSha256"):
                if hashlib.sha256(payload).hexdigest() != manifest["hostPackagesSha256"]:
                    raise ValueError("host package hash mismatch")
            metadata[name] = json.loads(payload)
            if name.endswith("versions.lock.json"):
                if hashlib.sha256(payload).hexdigest() != manifest["versionLockSha256"]:
                    raise ValueError("version lock hash mismatch")
                current = json.dumps(metadata[name], sort_keys=True)
                if version_hash is not None and current != version_hash:
                    raise ValueError("incompatible recovery version locks")
                version_hash = current
        package_inventories.append(metadata["meta/host-packages.json"])
        current_controls = sorted(manifest["forgeControlPlane"], key=lambda i: i["deploymentId"])
        if controls is not None and controls != current_controls:
            raise ValueError("signed deployment inventories do not agree")
        controls = current_controls
        snapshots.append({"host": catalog.host, "snapshotId": manifest["snapshotId"],
                          "createdAt": manifest["createdAt"], "captureStartedAt": item["created"].isoformat(), "resticSnapshotId": item["snapshot"]["id"],
                          "totals": manifest["totals"], "restoreFootprint": manifest["restoreFootprint"],
                          "signatureVerified": True, "metadataVerified": True,
                          "hostPackagesSigned": bool(manifest.get("hostPackagesSha256"))})
    try:
        target_packages = resolve(package_inventories)
    except ValueError as error:
        blockers.append(str(error))
        target_packages = None
    now = dt.datetime.now(UTC)
    ages = [(now - min(timestamp(s["createdAt"]), timestamp(s["captureStartedAt"]))).total_seconds() for s in snapshots]
    if min(ages) < -300:
        raise ValueError("snapshot is more than five minutes in the future")
    restored = sum(s["totals"]["restoredBytes"] for s in snapshots)
    images = sum(s["totals"]["imageBytes"] for s in snapshots)
    required = max(300_000_000_000, (restored * 225 + 99) // 100 + images + 30_000_000_000)
    return {"schemaVersion": 1, "mode": mode, "source": "r2", "writes": False,
            "metadataVerified": True, "restoreVerified": False, "liveRehearsalPassed": False,
            "createdAt": now.isoformat(), "snapshots": snapshots, "blockers": blockers,
            "preflightCompatible": not blockers, "targetPackages": target_packages,
            "packagePolicySha256": policy_hash(),
            "oldestSnapshotAgeSeconds": int(max(ages)), "rpo24HoursMet": max(ages) <= 86400,
            "requiredTargetDiskBytes": required, "forgeDeploymentCount": len(controls),
            "localStorage": "temporary signed metadata and restic metadata; no repository hydration or payload restore",
            "phases": [
                {"name": "select and authenticate compatible snapshots", "status": "verified"},
                {"name": "verify signed capacity, package and image inventories", "status": "verified"},
                *[{"name": name, "status": "not-executed"} for name in [
                    "provision target and bootstrap pinned packages over Tailscale",
                    "restore databases, storage, Samba and configuration",
                    "pull immutable GHCR images and restore Forge environments",
                    "verify database semantics, file hashes and local services",
                    "fence sources and prove dedicated DR tunnel probes",
                    "switch reviewed DNS, active-site leases and backup ownership",
                    "verify public applications and exercise rollback"]]],
            "remainingGates": ["full repository data read", "payload restore and semantic verification",
                               "GHCR pull credentials and image availability", "provider capacity and target networking",
                               "source isolation, cutover and rollback", "measured live RTO and both live rehearsals"]}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("pi", "forge", "all"), required=True)
    parser.add_argument("--snapshot", default="latest")
    parser.add_argument("--mode", choices=("plan", "simulate"), default="plan")
    parser.add_argument("--stage", help="existing recovery work directory; emit stage items for real recovery")
    args = parser.parse_args()
    profiles = ("pi", "forge") if args.profile == "all" else (args.profile,)
    with tempfile.TemporaryDirectory(prefix="deniz-dr-metadata-") as work:
        catalogs = {p: Catalog(p, work).load() for p in profiles}
        items = select(catalogs, args.snapshot)
        if args.stage:
            output = []
            for item in items:
                catalog = catalogs[item["ready"]["profile"]]
                ready = item["ready"]
                destination = Path(args.stage) / ("r2-" + catalog.host)
                (destination / "ready").mkdir(parents=True, mode=0o700)
                for suffix in ("", ".sig"):
                    shutil.copyfile(item["path"] + suffix, destination / "ready" / (ready["snapshotId"] + ".json" + suffix))
                output.append({"hydrated": True, "verified": True, "source": "r2", "host": catalog.host,
                               "snapshotId": ready["snapshotId"], "generation": ready["generation"],
                               "path": str(destination), "repository": catalog.repository,
                               "resticSnapshotId": item["snapshot"]["id"],
                               "sourceResticSnapshotId": ready["resticSnapshotId"]})
            print(json.dumps(output))
        else:
            result = plan(catalogs, items, args.mode)
            print(json.dumps(result, indent=2))
            if result["blockers"]:
                raise SystemExit(2)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, RuntimeError, KeyError, StopIteration, OSError) as error:
        sys.exit(f"STOP: {error}")
