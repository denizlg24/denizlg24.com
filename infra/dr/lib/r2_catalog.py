"""Signed R2 recovery catalog. Only metadata is downloaded; no restore or writes.

READY inventories describe the source repository. A restic copy has different
pack/snapshot IDs, so authenticate READY, resolve `original`, then authenticate
the small snapshot manifest by its signed hash inside the destination snapshot.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
UTC = dt.timezone.utc
HOSTS = {"pi": "pi-cloud", "forge": "forge"}
HEX = r"[0-9a-f]{64}"


def run(args, *, env=None, input=None):
    result = subprocess.run([str(a) for a in args], env=env, input=input,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Commands can include private repository URLs; never echo credentials.
        raise RuntimeError(f"{Path(args[0]).name} {args[1]} failed (exit {result.returncode})")
    return result.stdout


def timestamp(value):
    value = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    if value.tzinfo is None:
        raise ValueError("timestamp must have a timezone")
    return value.astimezone(UTC)


def private_file(value):
    path = Path(value)
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("credential file must be regular and mode 0600/0400")
    return path


def r2_env():
    env = dict(os.environ)
    if not re.fullmatch(r"https://[A-Za-z0-9.-]+", env.get("R2_ENDPOINT", "")):
        raise ValueError("R2_ENDPOINT must be a bare HTTPS origin")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,62}", env.get("R2_BUCKET", "")):
        raise ValueError("invalid R2_BUCKET")
    for key in ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"):
        if not env.get(key):
            raise ValueError(f"{key} is required")
    env["AWS_DEFAULT_REGION"] = env.get("AWS_DEFAULT_REGION", "auto")
    return env


class Catalog:
    def __init__(self, profile, work, *, no_cache=True):
        self.profile = profile
        self.host = HOSTS[profile]
        self.work = Path(work) / self.host
        self.work.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.env = r2_env()
        suffix = "PI" if profile == "pi" else "FORGE"
        password = self.env.get(f"DR_RESTIC_PASSWORD_FILE_{suffix}") or self.env.get("DR_RESTIC_PASSWORD_FILE", "")
        self.env["RESTIC_PASSWORD_FILE"] = str(private_file(password))
        self.repository = f"s3:{self.env['R2_ENDPOINT']}/{self.env['R2_BUCKET']}/{self.host}"
        self.env["RESTIC_REPOSITORY"] = self.repository
        self.signer = self.env.get(f"DR_HOST_SIGNER_{suffix}", self.host)
        self.signers = self.env.get("DR_ALLOWED_SIGNERS", "")
        if not Path(self.signers).is_file() or Path(self.signers).is_symlink():
            raise ValueError("DR_ALLOWED_SIGNERS must name the trusted signing public keys")
        self.no_cache = no_cache
        self.snapshots = self.restic_json("snapshots", "--json", "--no-lock")
        if not isinstance(self.snapshots, list):
            raise ValueError("invalid snapshot listing")
        self.by_source = {}
        for snapshot in self.snapshots:
            if (not re.fullmatch(HEX, snapshot.get("id", "")) or snapshot.get("hostname") != self.host
                    or f"dr-{profile}" not in snapshot.get("tags", [])):
                raise ValueError("unexpected snapshot identity in profile repository")
            self.by_source[snapshot["id"]] = snapshot
            if snapshot.get("original"):
                self.by_source[snapshot["original"]] = snapshot
        self.ready = {}
        self.missing = []

    def restic(self, *args):
        return run(["restic", *(["--no-cache"] if self.no_cache else []), *args], env=self.env)

    def restic_json(self, *args):
        return json.loads(self.restic(*args))

    def objects(self):
        return run([str(ROOT / "lib/r2-object"), "list", f"{self.host}/"], env=self.env).decode().splitlines()

    def load(self):
        pattern = rf"{self.host}/([0-9]{{4}}-Q[1-4])/ready/({self.host}-[0-9]{{8}}T[0-9]{{6}}Z)\.json"
        for line in self.objects():
            size, key = line.split("\t", 1)
            match = re.fullmatch(pattern, key)
            if not match:
                continue
            if int(size) > 16 * 1024 * 1024:
                raise ValueError("READY exceeds 16 MiB metadata limit")
            generation, snapshot_id = match.groups()
            path = self.work / f"{snapshot_id}.json"
            for remote, dest in [(key, path), (key + ".sig", Path(str(path) + ".sig"))]:
                run([str(ROOT / "lib/r2-object"), "get", remote, dest], env=self.env)
            run(["ssh-keygen", "-q", "-Y", "verify", "-f", self.signers, "-I", self.signer,
                 "-n", "deniz-dr-ready", "-s", str(path) + ".sig"], input=path.read_bytes())
            ready = json.loads(path.read_bytes())
            if (ready.get("schemaVersion") != 1 or ready.get("host") != self.host
                    or ready.get("profile") != self.profile or ready.get("generation") != generation
                    or ready.get("snapshotId") != snapshot_id
                    or not re.fullmatch(HEX, ready.get("forgeControlPlaneSha256", ""))
                    or not re.fullmatch(r"[0-9a-f]{8,64}", ready.get("resticSnapshotId", ""))):
                raise ValueError("signed READY identity is inconsistent with its key")
            snapshot = self.by_source.get(ready["resticSnapshotId"])
            if snapshot is None:
                matches = [s for k, s in self.by_source.items() if k.startswith(ready["resticSnapshotId"])]
                matches = {s["id"]: s for s in matches}
                if len(matches) == 1:
                    snapshot = next(iter(matches.values()))
            item = {"ready": ready, "key": key, "path": str(path), "snapshot": snapshot}
            if snapshot is None:
                self.missing.append(item)
                continue
            # Age is the start of capture, not the later upload/completion time.
            item["created"] = dt.datetime.strptime(snapshot_id[len(self.host)+1:], "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
            if abs((timestamp(snapshot["time"]) - item["created"]).total_seconds()) > 86400:
                raise ValueError("restic timestamp disagrees with signed capture identity")
            self.ready[snapshot_id] = item
        return self

    def manifest(self, item):
        snapshot = item["snapshot"]
        paths = snapshot.get("paths", [])
        if len(paths) != 1 or not re.fullmatch(r"/var/lib/deniz-dr/staging/(pi-cloud|forge)-[0-9]{8}T[0-9]{6}Z", paths[0]):
            raise ValueError("unexpected snapshot staging path")
        filename = "/snapshot-manifest.json"
        # dump decrypts only this file's packs. Never run restore, stats, or ls
        # over the namespace to calculate a plan.
        payload = self.restic("dump", "--no-lock", snapshot["id"], filename)
        if len(payload) > 16 * 1024 * 1024:
            raise ValueError("snapshot manifest exceeds metadata limit")
        ready = item["ready"]
        if hashlib.sha256(payload).hexdigest() != ready["snapshotManifest"]["sha256"]:
            raise ValueError("snapshot manifest does not match signed READY hash")
        manifest = json.loads(payload)
        for key in ("schemaVersion", "host", "profile", "snapshotId", "generation", "forgeControlPlaneSha256"):
            if manifest.get(key) != ready.get(key):
                raise ValueError(f"snapshot manifest disagrees with READY: {key}")
        totals = manifest["totals"]
        for key, rows in [("artifactBytes", manifest["artifacts"]), ("restoredBytes", manifest["restoreFootprint"])]:
            if any(type(row["bytes"]) is not int or row["bytes"] < 0 for row in rows):
                raise ValueError("invalid signed footprint")
            if totals[key] != sum(row["bytes"] for row in rows):
                raise ValueError("signed footprint total mismatch")
        if any(type(totals[k]) is not int or not 0 <= totals[k] <= 10**15
               for k in ("artifactBytes", "restoredBytes", "imageBytes")):
            raise ValueError("invalid signed totals")
        images = {i["reference"]: i["imageSizeBytes"] for i in manifest["images"]}
        if totals["imageBytes"] != sum(images.values()):
            raise ValueError("image footprint total mismatch")
        item["manifest"] = manifest
        return manifest


def select(catalogs, wanted="latest"):
    ordered = {p: sorted(c.ready.values(), key=lambda i: i["created"], reverse=True) for p, c in catalogs.items()}
    if any(not items for items in ordered.values()):
        raise ValueError("no signed, fully copied recovery snapshot")
    if wanted != "latest":
        ids = wanted.split(",")
        if len(ids) != len(catalogs):
            raise ValueError("supply one snapshot ID per selected profile (Pi first)")
        result = [c.ready[sid] for c, sid in zip(catalogs.values(), ids)]
    elif len(catalogs) == 1:
        result = [next(iter(ordered.values()))[0]]
    else:
        result = next(([pi, forge] for pi in ordered["pi"] for forge in ordered["forge"]
                       if pi["ready"]["forgeControlPlaneSha256"] == forge["ready"]["forgeControlPlaneSha256"]), None)
        if result is None:
            raise ValueError("no compatible Pi/Forge control-plane pair in R2")
    if len({i["ready"]["forgeControlPlaneSha256"] for i in result}) != 1:
        raise ValueError("selected snapshots have incompatible control planes")
    return result
