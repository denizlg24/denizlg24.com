import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("restore_r2", Path(__file__).parents[1] / "remote/restore-r2.py")
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class PayloadAuthentication(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        (self.root / "artifact").write_bytes(b"backup")
        self.manifest = {"host": "pi-cloud", "artifacts": [{"path": "artifact", "bytes": 6,
            "sha256": hashlib.sha256(b"backup").hexdigest()}]}

    def write_manifest(self):
        path = self.root / "snapshot-manifest.json"
        path.write_text(json.dumps(self.manifest))
        return restore.sha256(path)

    def test_authenticated_payload(self):
        restore.verify_payload(self.root, self.write_manifest(), "pi-cloud")

    def test_manifest_tampering(self):
        expected = self.write_manifest()
        (self.root / "snapshot-manifest.json").write_text("{}")
        with self.assertRaisesRegex(ValueError, "signed READY"):
            restore.verify_payload(self.root, expected, "pi-cloud")

    def test_corrupt_payload(self):
        expected = self.write_manifest()
        (self.root / "artifact").write_bytes(b"broken")
        with self.assertRaisesRegex(ValueError, "checksum"):
            restore.verify_payload(self.root, expected, "pi-cloud")

    def test_path_traversal(self):
        self.manifest["artifacts"][0]["path"] = "../artifact"
        with self.assertRaisesRegex(ValueError, "unsafe artifact"):
            restore.verify_payload(self.root, self.write_manifest(), "pi-cloud")

    def test_symlink_payload(self):
        (self.root / "artifact").unlink()
        (self.root / "artifact").symlink_to("/etc/passwd")
        with self.assertRaisesRegex(ValueError, "escapes"):
            restore.verify_payload(self.root, self.write_manifest(), "pi-cloud")

    def test_wrong_host(self):
        with self.assertRaisesRegex(ValueError, "wrong host"):
            restore.verify_payload(self.root, self.write_manifest(), "forge")


if __name__ == "__main__":
    unittest.main()
