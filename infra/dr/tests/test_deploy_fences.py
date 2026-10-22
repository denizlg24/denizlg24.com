import os
from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ("release-cloud", "release-cloud-terminal", "release-deploy-agent", "release-markets-relay")


class DeployFenceTests(unittest.TestCase):
    def acquire(self, workflow, *, pid=None, live=False, old=False):
        text = (ROOT / f".github/workflows/{workflow}.yml").read_text()
        match = re.search(r"^          set -euo pipefail\n          token=\"\$1\"; wait_seconds=.*?^          REMOTE", text, re.M | re.S)
        self.assertIsNotNone(match)
        script = textwrap.dedent(match.group().rsplit("\n", 1)[0])
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            lock = root / "host.lock"
            lock.mkdir()
            (lock / "owner").write_text("previous")
            if pid:
                (lock / "pid").write_text(pid)
            if live:
                (root / "proc" / pid).mkdir(parents=True)
            if old:
                timestamp = time.time() - 7200
                os.utime(lock, (timestamp, timestamp))
            dig = root / "dig"
            dig.write_text('#!/usr/bin/env bash\necho \'"home"\'\n')
            dig.chmod(0o755)
            script = re.sub(r"/var/lib/deniz-dr/locks/[a-z-]+\.lock", str(lock), script)
            script = script.replace('/proc/$pid', f'{root}/proc/$pid')
            result = subprocess.run(["bash", "-s", "--", "new-holder", "0", "60"], input=script,
                                    env={**os.environ, "PATH": f"{root}:{os.environ['PATH']}"},
                                    text=True, capture_output=True, timeout=5)
            return result, (lock / "owner").read_text().strip()

    def test_old_live_backup_is_never_reclaimed(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                result, owner = self.acquire(workflow, pid="123", live=True, old=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(owner, "previous")

    def test_dead_backup_is_reclaimed_without_waiting_an_hour(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow):
                result, owner = self.acquire(workflow, pid="123")
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(owner, "new-holder")

    def test_only_old_pidless_deploys_are_reclaimed(self):
        for workflow in WORKFLOWS:
            for old in (False, True):
                with self.subTest(workflow=workflow, old=old):
                    result, owner = self.acquire(workflow, old=old)
                    self.assertEqual(result.returncode == 0, old, result.stderr)
                    self.assertEqual(owner, "new-holder" if old else "previous")


if __name__ == "__main__":
    unittest.main()
