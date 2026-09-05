"""Retention safety and a real tiny restic metadata rehearsal (no cloud/VPS)."""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import r2_catalog as catalog_module
from r2_catalog import Catalog, UTC, select
from r2_retention import guarded_plan
from recovery_plan import plan
from recovery_packages import resolve


class RetentionTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 9, 5, tzinfo=UTC)
        self.snapshots = [{"id": str(i), "time": (self.now - dt.timedelta(days=i * 20)).isoformat()}
                          for i in range(8)]

    def groups(self, count=1):
        return [{"keep": self.snapshots[:-count], "remove": self.snapshots[-count:]}]

    def test_policy_keeps_recent_and_removes_old(self):
        keep, remove = guarded_plan(self.snapshots, self.groups(), self.now)
        self.assertEqual(remove, ["7"])
        self.assertIn("0", keep)

    def test_empty_stale_future_and_mass_delete_stop(self):
        for snapshots, groups, now in [([], [], self.now),
            (self.snapshots, self.groups(), self.now + dt.timedelta(days=2)),
            (self.snapshots, self.groups(), self.now - dt.timedelta(days=1)),
            (self.snapshots, self.groups(4), self.now)]:
            with self.subTest(snapshots=snapshots, now=now), self.assertRaises(ValueError):
                guarded_plan(snapshots, groups, now)

    def test_missing_duplicate_and_recent_deletion_stop(self):
        for groups in [[{"keep": self.snapshots[:-1]}],
                       [{"keep": self.snapshots, "remove": self.snapshots[-1:]}],
                       [{"keep": self.snapshots[1:], "remove": self.snapshots[:1]}]]:
            with self.subTest(groups=groups), self.assertRaises(ValueError):
                guarded_plan(self.snapshots, groups, self.now)

    def test_bootstrap_preserves_every_snapshot(self):
        snapshots = self.snapshots[:1]
        self.assertEqual(guarded_plan(snapshots, [{"keep": snapshots}], self.now), (["0"], []))

    def test_selection_ignores_missing_copy_and_requires_pair(self):
        def item(host, digest, age):
            return {"ready": {"forgeControlPlaneSha256": digest}, "created": self.now-dt.timedelta(hours=age)}
        pi = type("C", (), {"ready": {"p": item("pi", "a", 1)}})()
        forge = type("C", (), {"ready": {"f-new": item("forge", "b", 0), "f-old": item("forge", "a", 2)}})()
        self.assertEqual(select({"pi": pi, "forge": forge})[1], forge.ready["f-old"])
        del forge.ready["f-old"]
        with self.assertRaises(ValueError):
            select({"pi": pi, "forge": forge})


class RecoveryPackageTests(unittest.TestCase):
    def test_known_arm_and_x86_sources_resolve_to_forge_target(self):
        old = {"docker-ce": "5:29.3.0-1~ubuntu.24.04~noble", "samba": "2:4.19.5+dfsg-4ubuntu9.7"}
        new = {"docker-ce": "5:29.7.2-1~ubuntu.24.04~noble"}
        result = resolve([old, new])
        self.assertEqual(result["docker-ce"], new["docker-ce"])
        self.assertEqual(result["samba"], old["samba"])
        self.assertEqual(old["docker-ce"], "5:29.3.0-1~ubuntu.24.04~noble")

    def test_unknown_versions_and_unlisted_conflicts_stop(self):
        for inventories in [[{"docker-ce": "5:30.0.0"}], [{"samba": "1"}, {"samba": "2"}]]:
            with self.subTest(inventories=inventories), self.assertRaises(ValueError):
                resolve(inventories)


class MetadataIntegrationTests(unittest.TestCase):
    def test_real_restic_dump_and_signature_without_payload_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            password = root / "password"
            password.write_text("fixture-password")
            password.chmod(0o600)
            key = root / "signing"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
            signers = root / "signers"
            signers.write_text("pi-cloud " + Path(str(key) + ".pub").read_text())
            stage = root / "stage"
            (stage / "meta").mkdir(parents=True)
            fixture = Path(__file__).parent / "fixtures/snapshot-manifest.valid.json"
            manifest = json.loads(fixture.read_text())
            now = dt.datetime.now(UTC)
            sid = "pi-cloud-" + now.strftime("%Y%m%dT%H%M%SZ")
            manifest.update(host="pi-cloud", profile="pi", snapshotId=sid,
                            generation=f"{now.year}-Q{(now.month-1)//3+1}", createdAt=now.strftime("%Y-%m-%dT%H:%M:%SZ"))
            versions = (Path(__file__).parents[1] / "versions.lock.json").read_bytes()
            (stage / "meta/versions.lock.json").write_bytes(versions)
            manifest["versionLockSha256"] = hashlib.sha256(versions).hexdigest()
            (stage / "meta/host-packages.json").write_text('{"restic":"0.19.1"}')
            payload = json.dumps(manifest).encode()
            (stage / "snapshot-manifest.json").write_bytes(payload)
            # A payload exists but the plan must never read or restore it.
            (stage / "payload.bin").write_bytes(b"not-part-of-the-rehearsal" * 10000)
            env = dict(os.environ, RESTIC_REPOSITORY=str(root / "repo"), RESTIC_PASSWORD_FILE=str(password))
            subprocess.run(["restic", "init"], env=env, check=True, capture_output=True)
            subprocess.run(["restic", "backup", ".", "--host", "pi-cloud", "--tag", "dr-pi"], cwd=stage,
                           env=env, check=True, capture_output=True)
            snapshot = json.loads(subprocess.check_output(["restic", "snapshots", "--json"], env=env))[0]
            ready = {k: manifest[k] for k in ("schemaVersion", "host", "profile", "generation", "snapshotId", "forgeControlPlaneSha256", "createdAt")}
            ready.update(resticSnapshotId=snapshot["id"], snapshotManifest={"path": "snapshot-manifest.json", "sha256": hashlib.sha256(payload).hexdigest()})
            ready_path = root / "ready.json"
            ready_path.write_text(json.dumps(ready))
            subprocess.run(["ssh-keygen", "-q", "-Y", "sign", "-f", str(key), "-n", "deniz-dr-ready", str(ready_path)], check=True)
            object_key = f"pi-cloud/{manifest['generation']}/ready/{sid}.json"
            commands = []
            original_run = catalog_module.run

            def transport(args, *, env=None, input=None):
                commands.append([str(a) for a in args])
                if Path(args[0]).name == "r2-object":
                    if args[1] == "list":
                        return f"{ready_path.stat().st_size}\t{object_key}\n".encode()
                    self.assertEqual(args[1], "get")
                    Path(args[3]).write_bytes(Path(str(ready_path) + (".sig" if str(args[2]).endswith(".sig") else "")).read_bytes())
                    return b""
                if args[0] == "restic":
                    result = original_run(args, env=dict(env, RESTIC_REPOSITORY=str(root / "repo")), input=input)
                    if "snapshots" in args:
                        snapshots = json.loads(result)
                        for entry in snapshots:
                            entry["paths"] = [f"/var/lib/deniz-dr/staging/{sid}"]
                        return json.dumps(snapshots).encode()
                    return result
                return original_run(args, env=env, input=input)

            with patch.dict(os.environ, R2_ENDPOINT="https://fixture.example", R2_BUCKET="dr-fixture",
                            AWS_ACCESS_KEY_ID="fixture", AWS_SECRET_ACCESS_KEY="fixture",
                            DR_RESTIC_PASSWORD_FILE_PI=str(password), DR_ALLOWED_SIGNERS=str(signers)), \
                 patch.object(catalog_module, "run", side_effect=transport):
                catalog = Catalog("pi", root / "work").load()
                result = plan({"pi": catalog}, select({"pi": catalog}), "simulate")
                self.assertTrue(result["metadataVerified"])
                self.assertFalse(result["restoreVerified"])
                self.assertFalse(result["writes"])
                self.assertGreaterEqual(result["requiredTargetDiskBytes"], 300_000_000_000)
                self.assertFalse(any("restore" in c or "prune" in c or "forget" in c for c in commands))
                self.assertFalse(any("payload.bin" in str(c) for c in commands))
                ready_path.write_text(ready_path.read_text().replace('"schemaVersion": 1', '"schemaVersion": 9'))
                with self.assertRaises(RuntimeError):
                    Catalog("pi", root / "tampered").load()


if __name__ == "__main__":
    unittest.main()
