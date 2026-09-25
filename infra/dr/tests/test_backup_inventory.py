"""Exercise the actual backup guard against changing production inventories."""
import json
from pathlib import Path
import subprocess
import unittest

SCRIPT = (Path(__file__).parents[1] / "backup").read_text()


def between(start, end):
    _, found, rest = SCRIPT.partition(start)
    assert found, f"backup no longer contains {start!r}"
    body, found, _ = rest.partition(end)
    assert found, f"backup no longer contains {end!r} after {start!r}"
    return body


RECOVERABLE_IMAGE = between("  recoverable_image='", "\n  '\n")
GATE = RECOVERABLE_IMAGE + between("jq -e \"$recoverable_image\"'", "' <<< \"$response\" >/dev/null")
OFFENDERS = RECOVERABLE_IMAGE + between("unrecoverable=\"$(jq -r \"$recoverable_image\"'", "' <<< \"$response\" 2>/dev/null")


def jq(*args, data):
    return subprocess.run(["jq", *args], input=json.dumps(data), text=True, capture_output=True)


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
        return jq("-e", GATE, data=data).returncode == 0

    def offenders(self, data):
        result = jq("-r", OFFENDERS, data=data)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

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

    def test_offender_list_names_every_image_the_gate_refuses(self):
        self.assertEqual(self.offenders(self.inventory(3)), "")
        for field, value in (("digest", None), ("recoverable", False), ("environmentCipher", None),
                             ("imageSizeBytes", 0), ("platform", "linux/arm64"), ("domain", "localhost")):
            data = self.inventory(3)
            data["images"][1][field] = value
            data["images"][1]["service"] = "web"
            self.assertFalse(self.accepts(data), field)
            self.assertEqual(self.offenders(data), "web (1)", field)

    def test_host_identity_comparison_detects_omissions_and_extras(self):
        guard = SCRIPT.split("'([.images[].deploymentId] | sort) == $running'", 1)
        self.assertEqual(len(guard), 2)
        data = self.inventory(16)
        for running, expected in (([str(i) for i in range(16)], 0), ([str(i) for i in range(15)], 1), ([str(i) for i in range(17)], 1)):
            result = subprocess.run(["jq", "-e", "--argjson", "running", json.dumps(sorted(running)),
                "([.images[].deploymentId] | sort) == $running"], input=json.dumps(data), text=True, capture_output=True)
            self.assertEqual(result.returncode, expected)

    def test_control_plane_inventory_aggregates_matching_databases(self):
        self.assertIn("map(.deployments) | add", SCRIPT)
        records = [
            {"database": "denizcloud", "deployments": [{"deploymentId": "a"}]},
            {"database": "denizcloud_auth_test", "deployments": []},
            {"database": "denizcloud_shard", "deployments": [{"deploymentId": "b"}]},
        ]
        result = subprocess.run(
            ["jq", "-s", "map(.deployments) | add | sort_by(.deploymentId)"],
            input="\n".join(json.dumps(record) for record in records),
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), [{"deploymentId": "a"}, {"deploymentId": "b"}])


if __name__ == "__main__":
    unittest.main()
