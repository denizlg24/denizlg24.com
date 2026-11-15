import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "infra/scripts/wait-tailnet-ssh.sh"


class TailnetSshTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        mock = f"#!{sys.executable}\n" + '''import json, os, pathlib, sys
root = pathlib.Path(os.environ["TEST_STATE"])
command = pathlib.Path(sys.argv[0]).name
operation = sys.argv[1] if command == "tailscale" else "ssh"
counter = root / ("calls-" + operation)
count = int(counter.read_text()) + 1 if counter.exists() else 1
counter.write_text(str(count))
if operation == "ip":
    if count <= int(os.environ.get("TEST_RESOLVE_FAILURES", "0")):
        print("peer not yet in netmap", file=sys.stderr)
        sys.exit(1)
    print(os.environ.get("TEST_ADDRESS", "100.89.155.9"))
elif operation == "status":
    print(json.dumps({"BackendState":"Running", "Peer":{"pi":{"HostName":"pi-cloud", "Online":False, "LastSeen":"2026-11-15T02:00:29Z", "TailscaleIPs":["100.89.155.9"]}}}))
else:
    (root / "ssh-arguments").write_text(json.dumps(sys.argv[1:]))
    if count <= int(os.environ.get("TEST_SSH_FAILURES", "0")):
        print("ssh: connect to host: Connection timed out", file=sys.stderr)
        sys.exit(255)
'''
        for name in ("tailscale", "ssh"):
            command = self.root / name
            command.write_text(mock)
            command.chmod(0o755)

    def run_check(self, host="pi-cloud", user="denizlg24", **overrides):
        environment = {
            **os.environ,
            "PATH": f"{self.root}:{os.environ['PATH']}",
            "TEST_STATE": str(self.root),
            "TAILNET_SSH_WAIT_SECONDS": "3",
            "TAILNET_SSH_POLL_SECONDS": "1",
            **overrides,
        }
        return subprocess.run(["bash", str(SCRIPT), host, user], env=environment,
                              text=True, capture_output=True, timeout=10)

    def test_exports_only_an_address_after_successful_ssh(self):
        result = self.run_check()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, "100.89.155.9\n")
        arguments = json.loads((self.root / "ssh-arguments").read_text())
        self.assertEqual(arguments[-2:], ["denizlg24@100.89.155.9", "true"])
        self.assertIn("BatchMode=yes", arguments)
        self.assertIn("ConnectTimeout=5", arguments)

    def test_retries_netmap_resolution(self):
        result = self.run_check(TEST_RESOLVE_FAILURES="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "calls-ip").read_text(), "2")

    def test_retries_transient_ssh_failure(self):
        result = self.run_check(TEST_SSH_FAILURES="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "calls-ssh").read_text(), "2")

    def test_stale_address_does_not_count_as_readiness(self):
        result = self.run_check(TEST_SSH_FAILURES="99", TAILNET_SSH_WAIT_SECONDS="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "")
        self.assertIn('"Online": false', result.stderr)
        self.assertIn('"LastSeen": "2026-11-15T02:00:29Z"', result.stderr)
        self.assertIn("No deployment lock was acquired", result.stderr)

    def test_unresolved_peer_stops_with_diagnostics(self):
        result = self.run_check(TEST_RESOLVE_FAILURES="99", TAILNET_SSH_WAIT_SECONDS="0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("peer not yet in netmap", result.stderr)
        self.assertFalse((self.root / "calls-ssh").exists())

    def test_refuses_non_tailnet_or_invalid_ipv4(self):
        for address in ("203.0.113.1", "100.1.2.3", "100.89.999.9", "100.89.155.9\n203.0.113.1"):
            with self.subTest(address=address):
                result = self.run_check(TEST_ADDRESS=address)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "calls-ssh").exists())

    def test_rejects_unsafe_arguments_and_invalid_timeouts(self):
        for host, user, wait in (("-bad", "denizlg24", "3"), ("pi-cloud", "-root", "3"),
                                 ("pi-cloud", "denizlg24", "bad")):
            with self.subTest(host=host, user=user, wait=wait):
                result = self.run_check(host, user, TAILNET_SSH_WAIT_SECONDS=wait)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.root / "calls-ssh").exists())


if __name__ == "__main__":
    unittest.main()
