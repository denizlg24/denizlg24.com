import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import textwrap
import time
import unittest

ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = ("release-cloud", "release-cloud-terminal", "release-deploy-agent", "release-markets-relay")


class DeployFenceTests(unittest.TestCase):
    def script(self, workflow, root):
        text = (ROOT / f".github/workflows/{workflow}.yml").read_text()
        match = re.search(r"^          set -euo pipefail\n          token=\"\$1\"; wait_seconds=.*?^          REMOTE", text, re.M | re.S)
        self.assertIsNotNone(match)
        script = textwrap.dedent(match.group().rsplit("\n", 1)[0])
        script = re.sub(r"/var/lib/deniz-dr/locks/[a-z-]+\.lock", str(root / "host.lock"), script)
        return script.replace('/proc/$pid', f'{root}/proc/$pid')

    def commands(self, root):
        dig = root / "dig"
        dig.write_text('#!/usr/bin/env bash\necho \'"home"\'\n')
        dig.chmod(0o755)
        # macOS has flock(2), but no flock CLI. Use the same OS primitive in
        # tests so the extracted Linux scripts also run on developer Macs.
        flock = root / "flock"
        flock.write_text(f'#!{sys.executable}\n' + '''import fcntl, os, pathlib, sys
if os.environ.get("ROLE") == "b" and sys.argv[1] == "-x":
    pathlib.Path(os.environ["GATE"] + ".b").touch()
fcntl.flock(int(sys.argv[-1]), fcntl.LOCK_UN if sys.argv[1] == "-u" else fcntl.LOCK_EX)
''')
        flock.chmod(0o755)
        return {**os.environ, "PATH": f"{root}:{os.environ['PATH']}"}

    def acquire(self, workflow, *, pid=None, live=False, old=False):
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
            result = subprocess.run(["bash", "-s", "--", "new-holder", "0", "60"], input=self.script(workflow, root),
                                    env=self.commands(root),
                                    text=True, capture_output=True, timeout=5)
            return result, (lock / "owner").read_text().strip()

    def test_reclaimer_cannot_remove_another_runners_replacement(self):
        for workflow in WORKFLOWS:
            with self.subTest(workflow=workflow), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                lock = root / "host.lock"
                lock.mkdir()
                (lock / "pid").write_text("123")
                (lock / "owner").write_text("abandoned")
                gate = root / "gate"
                env = {**self.commands(root), "GATE": str(gate)}
                mv = root / "mv"
                mv.write_text(f'#!{sys.executable}\n' + '''import os, pathlib, sys, time
gate = pathlib.Path(os.environ["GATE"])
if os.environ.get("ROLE") == "a":
    gate.with_suffix(".a").touch()
    while not gate.exists(): time.sleep(0.01)
os.execv("/bin/mv", ["mv", *sys.argv[1:]])
''')
                mv.chmod(0o755)
                script = root / "acquire.sh"
                script.write_text(self.script(workflow, root))
                processes = []
                try:
                    a = subprocess.Popen(["bash", str(script), "holder-a", "0", "60"],
                                         env={**env, "ROLE": "a"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    processes.append(a)
                    self.wait_for(lambda: gate.with_suffix(".a").exists())
                    b = subprocess.Popen(["bash", str(script), "holder-b", "0", "60"],
                                         env={**env, "ROLE": "b"}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                    processes.append(b)
                    self.wait_for(lambda: gate.with_suffix(".b").exists() or b.poll() is not None)
                    gate.touch()
                    _, errors = a.communicate(timeout=5)
                    self.assertEqual(a.returncode, 0, errors.decode())
                    b.communicate(timeout=5)
                    self.assertNotEqual(b.returncode, 0)
                    self.assertEqual((lock / "owner").read_text().strip(), "holder-a")
                finally:
                    gate.touch()
                    for process in processes:
                        if process.poll() is None: process.kill()
                        process.communicate(timeout=5)

    def wait_for(self, predicate):
        deadline = time.monotonic() + 5
        while not predicate():
            self.assertLess(time.monotonic(), deadline, "concurrency barrier timed out")
            time.sleep(0.01)

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
