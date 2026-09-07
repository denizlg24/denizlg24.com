"""Exercise the actual backup guard against changing production inventories."""
import json
from pathlib import Path
import subprocess
import unittest

SCRIPT = (Path(__file__).parents[1] / "backup").read_text()


class InventoryTests(unittest.TestCase):
    def inventory(self, count):
        return {"expected": count, "images": [{
            "deploymentId": str(i), "recoverable": True,
            "reference": "ghcr.io/example/app@sha256:" + "a" * 64,
            "digest": "sha256:" + "a" * 64, "platform": "linux/amd64",
            "imageSizeBytes": 1024, "environmentHmacSha256": "b" * 64,
            "environmentCipher": {"encrypted": "x", "iv": "y", "authTag": "z"},
            "domain": "app.example.com",
        } for i in range(count)]}

    def accepts(self, data):
        guard = SCRIPT.split("  jq -e '\n    (.expected", 1)[1].split("  ' <<< \"$response\"", 1)[0]
        result = subprocess.run(["jq", "-e", "(.expected" + guard], input=json.dumps(data), text=True, capture_output=True)
        return result.returncode == 0

    def test_growth_and_removal_need_no_configuration_change(self):
        for count in (1, 13, 14, 16, 40):
            self.assertTrue(self.accepts(self.inventory(count)), count)
        self.assertNotIn("DR_EXPECTED_FORGE_DEPLOYMENTS", SCRIPT)

    def test_incomplete_or_unrecoverable_inventory_is_rejected(self):
        for field, value in (("digest", None), ("recoverable", False), ("environmentCipher", None), ("imageSizeBytes", 0)):
            data = self.inventory(16)
            data["images"][-1][field] = value
            self.assertFalse(self.accepts(data), field)
        data = self.inventory(16)
        data["images"].pop()
        self.assertFalse(self.accepts(data))
        data = self.inventory(16)
        data["images"][-1]["deploymentId"] = "0"
        self.assertFalse(self.accepts(data))

    def test_host_identity_comparison_detects_omissions_and_extras(self):
        guard = SCRIPT.split("'([.images[].deploymentId] | sort) == $running'", 1)
        self.assertEqual(len(guard), 2)
        data = self.inventory(16)
        for running, expected in (([str(i) for i in range(16)], 0), ([str(i) for i in range(15)], 1), ([str(i) for i in range(17)], 1)):
            result = subprocess.run(["jq", "-e", "--argjson", "running", json.dumps(sorted(running)),
                "([.images[].deploymentId] | sort) == $running"], input=json.dumps(data), text=True, capture_output=True)
            self.assertEqual(result.returncode, expected)


if __name__ == "__main__":
    unittest.main()
