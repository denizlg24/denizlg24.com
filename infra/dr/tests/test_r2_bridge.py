import hashlib
import json
import datetime as dt
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import r2_bridge as bridge


class BridgeTests(unittest.TestCase):
    def test_transfer_verifies_bytes_before_upload_and_evicts_only_after_confirmation(self):
        payload = b"encrypted-restic-object"
        name = hashlib.sha256(payload).hexdigest()
        relative = f"data/{name[:2]}/{name}"
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            events = []
            with patch.object(bridge.r2, "request", return_value=(200, payload)), \
                 patch.object(bridge, "cloud_state", side_effect=lambda cmd, *_: events.append(cmd)):
                _, result = bridge.transfer_object("forge", relative, len(payload), root, {}, True)
            self.assertEqual(events, ["wait-uploaded", "evict"])
            self.assertEqual(result["sha256"], name)
            self.assertEqual((root / relative).read_bytes(), payload)

    def test_bad_hash_is_never_published(self):
        relative = "data/aa/" + "a" * 64
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            with patch.object(bridge.r2, "request", return_value=(200, b"wrong")), \
                 patch.object(bridge, "cloud_state") as cloud, self.assertRaisesRegex(ValueError, "hash mismatch"):
                bridge.transfer_object("forge", relative, 5, root, {}, True)
            self.assertFalse((root / relative).exists())
            cloud.assert_not_called()

    def test_unconfirmed_upload_is_never_evicted(self):
        payload = b"encrypted"
        name = hashlib.sha256(payload).hexdigest()
        with tempfile.TemporaryDirectory() as work:
            with patch.object(bridge.r2, "request", return_value=(200, payload)), \
                 patch.object(bridge, "cloud_state", side_effect=RuntimeError("upload failed")) as cloud:
                with self.assertRaises(RuntimeError):
                    bridge.transfer_object("forge", f"index/{name}", len(payload), Path(work).resolve(), {}, True)
                self.assertEqual(cloud.call_args.args[0], "wait-uploaded")
                self.assertEqual(cloud.call_count, 1)

    def test_resume_does_not_rehydrate_confirmed_pack(self):
        payload = b"encrypted"
        name = hashlib.sha256(payload).hexdigest()
        relative = f"index/{name}"
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            bridge.atomic(root / relative, payload)
            previous = {relative: {"bytes": len(payload), "sha256": name}}
            with patch.object(bridge, "digest", side_effect=AssertionError("unexpected hydration")), \
                 patch.object(bridge.r2, "request", side_effect=AssertionError("unexpected download")), \
                 patch.object(bridge, "cloud_state"):
                bridge.transfer_object("forge", relative, len(payload), root, previous, True)

    def test_symlinked_destinations_are_refused(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            (root / "link").symlink_to(root, target_is_directory=True)
            with self.assertRaises(ValueError):
                bridge.safe_path(root / "link/file")

    def test_snapshot_publication_follows_every_pack(self):
        class Catalog:
            host = "forge"
            profile = "forge"
            snapshots = []
            ready = {}

            def restic(self, *args):
                return b""

        events = []
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            (root / "state").mkdir()
            objects = [("snapshots/" + "a" * 64, 1), ("config", 1), ("data/bb/" + "b" * 64, 1)]
            def transfer(host, relative, *args):
                events.append(relative)
                return relative, {"bytes": 1, "sha256": "a" * 64}
            with patch.object(bridge, "inventory", return_value=objects), \
                 patch.object(bridge, "transfer_object", side_effect=transfer), \
                 patch.object(bridge, "confirm_object", side_effect=lambda _, result: result), \
                 patch.object(bridge, "select", side_effect=ValueError("stop before receipt")):
                with self.assertRaisesRegex(ValueError, "stop before receipt"):
                    bridge.mirror(Catalog(), root / "cloud", root / "state", 2)
            self.assertTrue(events[-1].startswith("snapshots/"))

    def test_full_mirror_publishes_a_verifiable_receipt_after_upload_confirmation(self):
        with tempfile.TemporaryDirectory() as work:
            root = Path(work).resolve()
            key = root / "signing-key"
            subprocess.run(["ssh-keygen", "-q", "-t", "ed25519", "-N", "", "-f", str(key)], check=True)
            signers = root / "allowed-signers"
            signers.write_text("mac-bridge " + Path(str(key) + ".pub").read_text())
            ready_path = root / "ready.json"
            ready_path.write_text('{"snapshotId":"forge-20260910T000000Z"}')
            Path(str(ready_path) + ".sig").write_text("already-authenticated-host-signature")
            item = {"created": dt.datetime.now(bridge.UTC), "ready": {"snapshotId": "forge-20260910T000000Z", "forgeControlPlaneSha256": "a" * 64},
                    "key": "forge/2026-Q3/ready/forge-20260910T000000Z.json", "path": str(ready_path)}
            catalog = type("Catalog", (), {"host": "forge", "profile": "forge", "snapshots": [{}],
                       "ready": {"fixture": item}, "restic": lambda *_: b""})()
            (root / "state").mkdir()
            confirmations = []
            with patch.dict(os.environ, {"DR_COMPLETION_SIGNING_KEY": str(key)}), \
                 patch.object(bridge, "inventory", return_value=[("config", 1)]), \
                 patch.object(bridge, "transfer_object", return_value=("config", {"bytes": 1, "sha256": "a" * 64})), \
                 patch.object(bridge, "confirm_object", side_effect=lambda _, result: result), \
                 patch.object(bridge, "cloud_state", side_effect=lambda _, target: confirmations.append(target)):
                bridge.mirror(catalog, root / "cloud", root / "state", 2)
            receipts = list((root / "cloud/receipts/forge").glob("*.json"))
            self.assertEqual(len(receipts), 1)
            receipt = receipts[0]
            subprocess.run(["ssh-keygen", "-q", "-Y", "verify", "-f", str(signers), "-I", "mac-bridge",
                            "-n", "deniz-dr-r2-mirror", "-s", str(receipt) + ".sig"],
                           input=receipt.read_bytes(), check=True, capture_output=True)
            self.assertEqual(confirmations[-1], receipt)
            self.assertEqual(json.loads((root / "state/forge.json").read_text())["phase"], "completed")


if __name__ == "__main__":
    unittest.main()
