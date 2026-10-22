import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[3]
SCRIPT = ROOT / "infra/scripts/ensure-storage-boundary.sh"


class StorageReconcileTests(unittest.TestCase):
    def run_case(self, **settings):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            stub = path / "systemctl"
            stub.write_text("""#!/usr/bin/env bash
echo "$*" >> "$CALLS"
case "$1" in
  show)
    if [[ "$*" == *LoadState* ]]; then echo "${LOAD:-loaded}";
    else echo "${WATCHDOG_EXIT:-0}"; fi ;;
  is-enabled) [[ "${ENABLED:-yes}" == yes ]] ;;
  start) touch "$STARTED" ;;
  is-active) [[ "$*" != *"${BROKEN:-none}"* ]] ;;
esac
""")
            stub.chmod(0o755)
            dig = path / "dig"
            dig.write_text('#!/usr/bin/env bash\nprintf \'"%s"\\n\' "${LEASE:-home}"\n')
            dig.chmod(0o755)
            env = {**os.environ, "PATH": f"{path}:{os.environ['PATH']}",
                   "CALLS": str(path / "calls"), "STARTED": str(path / "started"), **settings}
            result = subprocess.run(["bash", str(SCRIPT)], env=env, capture_output=True, text=True)
            return result, (path / "started").exists(), (path / "calls").read_text()

    def test_enabled_boundary_is_started_and_every_component_checked(self):
        result, started, calls = self.run_case()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(started)
        for component in ("namespace", "metadata", "firewall", "smb", "api-broker", "watchdog"):
            self.assertIn(f"is-active --quiet deniz-cloud-storage-{component}.service", calls)

    def test_missing_or_disabled_boundary_is_untouched(self):
        for settings in ({"LOAD": "not-found"}, {"ENABLED": "no"}):
            result, started, _ = self.run_case(**settings)
            self.assertEqual(result.returncode, 0)
            self.assertFalse(started)

    def test_deliberate_fail_close_is_preserved(self):
        result, started, _ = self.run_case(WATCHDOG_EXIT="20")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(started)

    def test_recovery_site_ownership_is_preserved(self):
        result, started, _ = self.run_case(LEASE="recovery")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(started)

    def test_unhealthy_component_cannot_report_success(self):
        result, started, _ = self.run_case(BROKEN="api-broker")
        self.assertTrue(started)
        self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
