#!/usr/bin/env python3
"""Copy encrypted R2 repositories to iCloud, or selected snapshots to local disk.

The iCloud layout preserves R2's repository IDs and host-signed READY documents.
Objects are immutable and copy-only. Snapshot objects and completion receipts
are published only after all repository data has a confirmed File Provider upload.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor, as_completed
import datetime as dt
import fcntl
import hashlib
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from r2_catalog import Catalog, HOSTS, ROOT, UTC, private_file, run, select

loader = importlib.machinery.SourceFileLoader("r2_object", str(ROOT / "lib/r2-object"))
r2 = importlib.util.module_from_spec(importlib.util.spec_from_loader(loader.name, loader))
loader.exec_module(r2)
OBJECT = re.compile(r"config|data/[0-9a-f]{2}/[0-9a-f]{64}|(?:index|keys|snapshots)/[0-9a-f]{64}")
RESERVE = 5 * 1024**3


def log(message):
    print(f"{dt.datetime.now(UTC).isoformat(timespec='seconds')} {message}", flush=True)


def safe_path(path):
    path = Path(path)
    if not path.is_absolute() or path == Path("/") or ".." in path.parts:
        raise ValueError("destination must be an absolute, non-root path")
    for parent in [*path.parents, path]:
        if parent.is_symlink():
            raise ValueError(f"refusing a symlink: {parent}")
    return path


def atomic(path, payload):
    safe_path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".dr-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def json_write(path, data):
    atomic(path, json.dumps(data, sort_keys=True, indent=2).encode())


def operation_lock_paths(state_root, command, profiles, destination=None):
    """Return the resources this operation must own.

    Per-profile locks let Pi and Forge copies run independently. Download locks
    also include the normalized destination, so a second recovery disk can be
    populated without allowing two writers into the same repository.
    """
    if command == "cycle":
        return [safe_path(state_root / f"cycle-{profile}.lock") for profile in sorted(profiles)]
    if destination is None:
        raise ValueError("download lock requires a destination")
    normalized = str(safe_path(destination).absolute())
    destination_id = hashlib.sha256(normalized.encode()).hexdigest()[:16]
    return [
        safe_path(state_root / f"download-{profile}-{destination_id}.lock")
        for profile in sorted(profiles)
    ]


@contextmanager
def operation_locks(paths):
    locks = []
    try:
        for path in paths:
            lock = path.open("a")
            locks.append(lock)
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise ValueError(
                    "this profile and destination already have a copy running; "
                    "use dr-backups status or choose another destination"
                ) from error
        yield
    finally:
        for lock in reversed(locks):
            try:
                fcntl.flock(lock, fcntl.LOCK_UN)
            finally:
                lock.close()


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def cloud_state(command, path, timeout="3600"):
    run([ROOT / "macos/dr-icloud-state", command, path, timeout])


def inventory(catalog):
    objects = []
    for line in catalog.objects():
        size, key = line.split("\t", 1)
        relative = key[len(catalog.host) + 1:]
        if OBJECT.fullmatch(relative):
            objects.append((relative, int(size)))
    if not objects or not any(p == "config" for p, _ in objects):
        raise ValueError("R2 repository inventory is incomplete")
    return objects


def transfer_object(host, relative, size, destination, previous, cloud, defer_confirmation=False):
    target = safe_path(destination / relative)
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    recorded = previous.get(relative)
    if relative != "config" and target.is_file() and recorded and target.stat().st_size == size == recorded["bytes"]:
        if cloud:
            # Query File Provider without opening (and hydrating) an evicted pack.
            if not defer_confirmation:
                cloud_state("wait-uploaded", target)
                cloud_state("evict", target)
            return relative, recorded
        if digest(target) == recorded["sha256"]:
            return relative, recorded
    if shutil.disk_usage(destination).free < size + RESERVE:
        raise ValueError("less than 5 GiB free; waiting for local space before copying more data")
    if target.exists():
        if cloud:
            # An interrupted run may have evicted a confirmed object before
            # persisting its checkpoint. Request hydration before opening it;
            # opening an evicted item directly can fail with EDEADLK on macOS.
            cloud_state("hydrate", target)
        actual = digest(target)
        if target.stat().st_size != size or (relative != "config" and actual != target.name):
            raise ValueError(f"immutable destination collision: {relative}")
        if relative == "config":
            status, payload = r2.request("GET", f"{host}/config")
            if status != 200 or hashlib.sha256(payload).hexdigest() != actual:
                raise ValueError("destination repository config differs from R2")
    else:
        status, payload = r2.request("GET", f"{host}/{relative}")
        if status != 200 or len(payload) != size:
            raise ValueError(f"R2 object unavailable or incomplete: {host}/{relative} (HTTP {status})")
        actual = hashlib.sha256(payload).hexdigest()
        if relative != "config" and actual != target.name:
            raise ValueError(f"R2 object hash mismatch: {relative}")
        atomic(target, payload)
    if cloud and not defer_confirmation:
        cloud_state("wait-uploaded", target)
        cloud_state("evict", target)
    return relative, {"bytes": size, "sha256": actual}


def confirm_object(destination, result):
    relative, evidence = result
    target = safe_path(destination / relative)
    cloud_state("wait-uploaded", target)
    cloud_state("evict", target)
    return relative, evidence


def mirror(catalog, root, state_root, workers):
    destination = safe_path(root / catalog.host)
    destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    state_path = safe_path(state_root / f"{catalog.host}.json")
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    previous = state.get("objects", {}) if state.get("destination") == str(destination) else {}
    state.pop("error", None)
    state.update(destination=str(destination), source="r2", phase="checking-source", objects=previous)
    json_write(state_path, state)
    catalog.restic("check", "--no-lock")
    objects = inventory(catalog)
    log(f"{catalog.host}: {len(objects)} encrypted objects, {sum(s for _, s in objects) / 1024**3:.2f} GiB; copy to {destination}")
    state.update(phase="copying", totalObjects=len(objects), totalBytes=sum(s for _, s in objects))
    json_write(state_path, state)
    completed = 0
    # A restic snapshot is its publication marker. Keep these until every
    # data/index/key object is confirmed remotely uploaded.
    for snapshot_phase in (False, True):
        batch = [(p, s) for p, s in objects if p.startswith("snapshots/") == snapshot_phase]
        # Queue a bounded batch before waiting. File Provider coalesces uploads;
        # waiting after each tiny index file otherwise spends a minute per file.
        for offset in range(0, len(batch), 64):
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = [pool.submit(transfer_object, catalog.host, p, s, destination, previous, True, True)
                           for p, s in batch[offset:offset + 64]]
                try:
                    staged = [future.result() for future in futures]
                    futures = [pool.submit(confirm_object, destination, result) for result in staged]
                    for future in as_completed(futures):
                        relative, evidence = future.result()
                        previous[relative] = evidence
                        completed += 1
                        if completed == 1 or completed % 16 == 0 or completed == len(objects):
                            state.update(phase="copying", confirmedObjects=completed)
                            json_write(state_path, state)
                            log(f"{catalog.host}: confirmed {completed}/{len(objects)} objects in iCloud")
                except BaseException:
                    for future in futures:
                        future.cancel()
                    state.update(phase="interrupted", confirmedObjects=completed)
                    json_write(state_path, state)
                    raise
    # Validate that concurrent source retention did not invalidate this pass.
    state.update(phase="publishing")
    json_write(state_path, state)
    catalog.restic("check", "--no-lock")
    latest = select({catalog.profile: catalog})[0]
    ready_targets = []
    for item in catalog.ready.values():
        for suffix in (".sig", ""):
            target = safe_path(root / (item["key"] + suffix))
            payload = Path(item["path"] + suffix).read_bytes()
            if target.exists():
                cloud_state("hydrate", target)
            if target.exists() and target.read_bytes() != payload:
                raise ValueError("immutable signed READY collision")
            if not target.exists():
                atomic(target, payload)
            ready_targets.append(target)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for future in [pool.submit(cloud_state, "wait-uploaded", target) for target in ready_targets]:
            future.result()
    receipt = {"schemaVersion": 1, "source": "r2", "host": catalog.host,
               "capturedAt": latest["created"].isoformat(), "snapshotId": latest["ready"]["snapshotId"],
               "completedAt": dt.datetime.now(UTC).isoformat(),
               "objects": {p: previous[p] for p, _ in objects},
               "snapshotCount": len(catalog.snapshots)}
    with tempfile.TemporaryDirectory(prefix="dr-receipt-") as temporary:
        # macOS gives mkdtemp a /var/folders path through the system /var
        # symlink. Resolve only this directory we just created; destination
        # paths still reject symlinks before any write.
        path = Path(temporary).resolve() / "receipt.json"
        json_write(path, receipt)
        run(["ssh-keygen", "-q", "-Y", "sign", "-f", private_file(os.environ["DR_COMPLETION_SIGNING_KEY"]),
             "-n", "deniz-dr-r2-mirror", path])
        base = root / "receipts" / catalog.host / dt.datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ.json")
        for suffix in (".sig", ""):
            target = Path(str(base) + suffix)
            atomic(target, Path(str(path) + suffix).read_bytes())
            cloud_state("wait-uploaded", target)
    state.update(phase="completed", confirmedObjects=completed, lastVerified=receipt)
    # The inventory is already at the top level; avoid duplicating it in status.
    state["lastVerified"] = {k: v for k, v in receipt.items() if k != "objects"}
    json_write(state_path, state)
    log(f"{catalog.host}: iCloud copy confirmed for {receipt['snapshotId']}")
    return receipt


def download(catalog, item, destination, plan_only):
    catalog.manifest(item)
    stats = catalog.restic_json("stats", "--mode", "raw-data", "--json", "--no-lock", item["snapshot"]["id"])
    root = safe_path(destination / catalog.host)
    parent = root
    while not parent.exists():
        parent = parent.parent
    required = stats["total_size"] + RESERVE
    print(json.dumps({"host": catalog.host, "snapshotId": item["ready"]["snapshotId"],
                      "destination": str(root), "estimatedBytes": stats["total_size"],
                      "requiredFreeBytes": required, "availableBytes": shutil.disk_usage(parent).free,
                      "planOnly": plan_only}), flush=True)
    if plan_only:
        return
    if shutil.disk_usage(parent).free < required:
        raise ValueError(f"{catalog.host}: insufficient disk space; use --destination on a larger volume")
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    repository = safe_path(root / "repository")
    env = dict(catalog.env, RESTIC_REPOSITORY=str(repository))
    if not repository.exists():
        run(["restic", "init", "--copy-chunker-params", "--from-repo", catalog.repository,
             "--from-password-file", env["RESTIC_PASSWORD_FILE"]], env=env)
    log(f"{catalog.host}: downloading encrypted snapshot")
    run(["restic", "copy", "--from-repo", catalog.repository, "--from-password-file",
         env["RESTIC_PASSWORD_FILE"], item["snapshot"]["id"]], env=env)
    snapshots = json.loads(run(["restic", "snapshots", "--json"], env=env))
    originals = {item["snapshot"]["id"], item["snapshot"].get("original")}
    matches = [s for s in snapshots if s["id"] in originals or s.get("original", s["id"]) in originals]
    if len(matches) != 1:
        raise ValueError("downloaded snapshot identity is ambiguous")
    payload = run(["restic", "dump", matches[0]["id"], "/snapshot-manifest.json"], env=env)
    if hashlib.sha256(payload).hexdigest() != item["ready"]["snapshotManifest"]["sha256"]:
        raise ValueError("downloaded snapshot manifest failed its signed hash")
    run(["restic", "check", "--read-data"], env=env)
    for suffix in (".sig", ""):
        atomic(root / "ready" / (item["ready"]["snapshotId"] + ".json" + suffix), Path(item["path"] + suffix).read_bytes())
    json_write(root / "download.json", {"verified": True, "snapshotId": item["ready"]["snapshotId"],
               "resticSnapshotId": matches[0]["id"], "repository": str(repository)})
    log(f"{catalog.host}: encrypted download verified at {root}")


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("cycle", "download", "status"))
    parser.add_argument("--profile", choices=("all", "pi", "forge"), default="all")
    parser.add_argument("--snapshot", default="latest", help="download: signed snapshot ID, or compatible latest pair")
    parser.add_argument("--destination", type=Path, default=Path.home() / "Downloads/Server Backups")
    parser.add_argument("--plan", action="store_true", help="download: authenticate and estimate without copying")
    parser.add_argument("--workers", type=int, choices=range(1, 9), default=4)
    args = parser.parse_args()
    state_root = safe_path(Path(os.environ["DR_LOCAL_CACHE"]) / "r2-bridge")
    state_root.mkdir(mode=0o700, parents=True, exist_ok=True)
    profiles = ("forge", "pi") if args.profile == "all" else (args.profile,)
    if args.command == "status":
        for profile in profiles:
            path = safe_path(state_root / f"{HOSTS[profile]}.json")
            state = json.loads(path.read_text()) if path.exists() else {"phase": "not-started"}
            print(json.dumps({"host": HOSTS[profile], **{k: v for k, v in state.items() if k != "objects"}}))
        return
    lock_paths = operation_lock_paths(
        state_root,
        args.command,
        profiles,
        args.destination if args.command == "download" else None,
    )
    with operation_locks(lock_paths), tempfile.TemporaryDirectory(prefix="dr-r2-bridge-") as temporary:
        if args.command == "download":
            # Pi first is the existing signed pair-selection contract.
            ordered = ("pi", "forge") if args.profile == "all" else profiles
            catalogs = {p: Catalog(p, temporary, no_cache=False).load() for p in ordered}
            for item in select(catalogs, args.snapshot):
                download(catalogs[item["ready"]["profile"]], item, args.destination, args.plan)
        else:
            root = safe_path(Path(os.environ["DR_ICLOUD_ROOT"]) / "R2")
            if "/Library/Mobile Documents/" not in str(root):
                raise ValueError("DR_ICLOUD_ROOT must be inside iCloud Drive")
            private_file(os.environ["DR_COMPLETION_SIGNING_KEY"])
            receipts = []
            for profile in profiles:
                catalog = Catalog(profile, temporary, no_cache=False).load()
                select({profile: catalog})
                try:
                    receipts.append(mirror(catalog, root, state_root, args.workers))
                except Exception as error:
                    state_path = safe_path(state_root / f"{catalog.host}.json")
                    state = json.loads(state_path.read_text()) if state_path.exists() else {}
                    state.update(phase="failed", error=str(error))
                    json_write(state_path, state)
                    raise
            if args.profile == "all":
                if any((dt.datetime.now(UTC) - dt.datetime.fromisoformat(r["capturedAt"])).total_seconds() > 36 * 3600 for r in receipts):
                    raise ValueError("iCloud data was copied but the source capture is overdue; heartbeat withheld")
                for key in ("DR_ICLOUD_WARNING_HEARTBEAT_URL", "DR_ICLOUD_CRITICAL_HEARTBEAT_URL"):
                    url = os.environ.get(key, "")
                    if not re.fullmatch(r"https://uptime\.betterstack\.com/[A-Za-z0-9/_-]+", url):
                        raise ValueError("missing or invalid iCloud heartbeat URL")
                    run(["curl", "--config", "-"], input=f'url = "{url}"\nfail\nsilent\nshow-error\nmax-time = 15\n'.encode())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        log(f"STOP: {error}")
        sys.exit(1)
