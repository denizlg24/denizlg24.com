#!/usr/bin/env python3
"""Copy only authenticated, recent snapshots; publish signature before READY."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from r2_catalog import HOSTS, ROOT, UTC, private_file, r2_env, run, timestamp


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=("pi", "forge"), required=True)
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    host = HOSTS[args.profile]
    env = r2_env()
    password = str(private_file(env["DR_RESTIC_PASSWORD_FILE"]))
    remote = f"s3:{env['R2_ENDPOINT']}/{env['R2_BUCKET']}/{host}"
    base = ["restic", "-r", remote, "--password-file", password]
    listing = subprocess.run([*base, "snapshots", "--json", "--no-lock"], env=env, capture_output=True)
    absent = False
    if listing.returncode:
        probe = subprocess.run([str(ROOT / "lib/r2-object"), "head", f"{host}/config"], env=env, capture_output=True)
        absent = probe.returncode == 4
    if absent:
        if args.execute:
            run([*base, "init"], env=env)
        remote_snapshots = []
    elif listing.returncode:
        raise RuntimeError("R2 snapshot listing failed; refusing to interpret failure as an empty repository")
    else:
        remote_snapshots = json.loads(listing.stdout)
    existing = {s.get("original", s["id"]) for s in remote_snapshots}
    root = Path(env.get("DR_REMOTE_ROOT", "/var/lib/deniz-dr"))
    if not root.is_absolute() or root == Path("/"):
        raise ValueError("unsafe DR_REMOTE_ROOT")
    repositories = sorted((root / "repositories" / host).glob("????-Q[1-4]"))
    if not repositories:
        raise ValueError("no local quarterly repositories")
    now = dt.datetime.now(UTC)
    copied = 0
    published = 0
    pending = 0
    newest_capture = None
    # Inspect all generations, so a failed last-quarter upload still heals
    # after rollover. Never copy >14-day-old snapshots that retention retired.
    for repository in repositories:
        local = ["restic", "-r", str(repository), "--password-file", password]
        snapshots = json.loads(run([*local, "snapshots", "--json", "--no-lock"], env=env))
        candidates = {s["id"]: s for s in snapshots}
        ready_root = root / "ready" / host / repository.name
        for manifest in sorted(ready_root.glob("*.json")):
            ready = json.loads(manifest.read_bytes())
            sid = ready.get("resticSnapshotId", "")
            if not re.fullmatch(r"[0-9a-f]{8,64}", sid):
                raise ValueError("invalid source snapshot ID")
            matches = [s for key, s in candidates.items() if key.startswith(sid)]
            if len(matches) != 1:
                continue  # local retention already forgot it
            snapshot = matches[0]
            if now - timestamp(snapshot["time"]) > dt.timedelta(days=14):
                continue
            if timestamp(snapshot["time"]) > now + dt.timedelta(minutes=5):
                raise ValueError("future local snapshot")
            if (ready.get("host") != host or ready.get("profile") != args.profile
                    or ready.get("generation") != repository.name
                    or ready.get("snapshotId") + ".json" != manifest.name):
                raise ValueError("READY identity mismatch")
            signers = env.get("DR_ALLOWED_SIGNERS", "/etc/deniz-dr/allowed_signers")
            run(["ssh-keygen", "-q", "-Y", "verify", "-f", signers, "-I", host,
                 "-n", "deniz-dr-ready", "-s", str(manifest) + ".sig"], input=manifest.read_bytes())
            capture = dt.datetime.strptime(ready["snapshotId"][len(host)+1:], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            newest_capture = max(capture, newest_capture or capture)
            if snapshot["id"] not in existing:
                pending += 1
                if args.execute:
                    run([*base, "copy", "--from-repo", str(repository), "--from-password-file", password, snapshot["id"]], env=env)
                    existing.add(snapshot["id"])
                    copied += 1
            if args.execute:
                # Idempotent small PUTs heal interrupted publication, including
                # a manifest uploaded by the older script without a signature.
                key = f"{host}/{repository.name}/ready/{manifest.name}"
                for remote_key, path in [(key + ".sig", str(manifest) + ".sig"), (key, manifest)]:
                    run([str(ROOT / "lib/r2-object"), "put", remote_key, path], env=env)
                published += 1
    if newest_capture is None or now - newest_capture > dt.timedelta(hours=36):
        raise ValueError("no authenticated capture in the last 36 hours; offsite heartbeat withheld")
    if args.execute:
        final = json.loads(run([*base, "snapshots", "--json", "--no-lock"], env=env))
        final_ids = {s.get("original", s["id"]) for s in final}
        if not existing.issubset(final_ids):
            raise ValueError("offsite copy verification failed")
    if args.execute and env.get("DR_R2_REQUIRE_RETENTION") == "true":
        marker = root / f"r2-retention-{args.profile}.success"
        failed = root / f"r2-retention-{args.profile}.failed"
        if failed.exists() or not marker.is_file() or not 0 <= now.timestamp() - marker.stat().st_mtime <= 8 * 86400:
            raise ValueError("R2 copy finished but retention is failed or overdue; heartbeat withheld")
    print(json.dumps({"writes": args.execute, "synced": args.execute, "host": host,
                      "wouldCopy": pending, "snapshotsCopied": copied, "manifestsPublished": published,
                      "newestCapture": newest_capture.isoformat()}))


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, RuntimeError, KeyError, TypeError, OSError) as error:
        sys.exit(f"STOP: {error}")
