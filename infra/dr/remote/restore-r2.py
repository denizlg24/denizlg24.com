#!/usr/bin/env python3
"""Restore R2 payload on the target and authenticate it before activation."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verify_payload(root, expected_manifest, host):
    manifest = root / "snapshot-manifest.json"
    if manifest.is_symlink() or sha256(manifest) != expected_manifest:
        raise ValueError("restored manifest differs from signed READY")
    data = json.loads(manifest.read_text())
    if data["host"] != host:
        raise ValueError("restored manifest has the wrong host")
    for artifact in data["artifacts"]:
        relative = Path(artifact["path"])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("unsafe artifact path")
        path = root / relative
        if path.is_symlink() or not path.resolve().is_relative_to(root.resolve()):
            raise ValueError("artifact escapes restore root")
        if path.stat().st_size != artifact["bytes"] or sha256(path) != artifact["sha256"]:
            raise ValueError("restored artifact checksum failed: " + str(relative))


def main():
    parser = argparse.ArgumentParser()
    for name in ("root", "host", "snapshot", "repository", "credentials", "manifest-sha256"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    root = Path(args.root)
    credentials = Path(args.credentials)
    if not re.fullmatch(r"/srv/deniz-dr/restore/dr-[0-9a-f]{20}", str(root)):
        raise ValueError("unsafe recovery root")
    if args.host not in ("pi-cloud", "forge"):
        raise ValueError("invalid source host")
    if not re.fullmatch(r"[0-9a-f]{64}", args.snapshot) or not re.fullmatch(r"[0-9a-f]{64}", args.manifest_sha256):
        raise ValueError("invalid snapshot or manifest hash")
    if credentials != root / ("r2-restore-" + args.host + ".json") or credentials.is_symlink():
        raise ValueError("unsafe credential path")
    destination = root / args.host
    try:
        secrets = json.loads(credentials.read_text())
        allowed = {"AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_DEFAULT_REGION", "RESTIC_PASSWORD"}
        if set(secrets) != allowed or any(not isinstance(v, str) or not v for v in secrets.values()):
            raise ValueError("invalid restore credentials")
        env = os.environ.copy()
        env.update(secrets)
        env["RESTIC_REPOSITORY"] = args.repository
        if destination.exists():
            # A failed restore phase may resume, but never trust an existing
            # payload merely because the directory is present.
            verify_payload(destination, args.manifest_sha256, args.host)
            return
        with tempfile.TemporaryDirectory(prefix=".r2-" + args.host + "-", dir=root) as stage:
            subprocess.run(["restic", "restore", "--no-lock", args.snapshot, "--target", stage], env=env, check=True)
            manifests = list(Path(stage).rglob("snapshot-manifest.json"))
            if len(manifests) != 1:
                raise ValueError("expected exactly one restored manifest")
            payload = manifests[0].parent
            verify_payload(payload, args.manifest_sha256, args.host)
            # Move a child of the temporary directory; moving stage itself
            # would defeat TemporaryDirectory cleanup.
            if payload == Path(stage):
                destination.mkdir(mode=0o700)
                for child in payload.iterdir():
                    shutil.move(str(child), destination / child.name)
            else:
                payload.rename(destination)
        print(json.dumps({"host": args.host, "payloadVerified": True}))
    finally:
        credentials.unlink(missing_ok=True)


if __name__ == "__main__":
    os.umask(0o077)
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit("STOP: " + str(error))
