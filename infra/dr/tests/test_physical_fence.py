import json
from pathlib import Path
import subprocess
import tempfile
import unittest


class PhysicalFenceTests(unittest.TestCase):
    def run_gate(self, phrase):
        text = (Path(__file__).parents[1] / "cutover").read_text()
        gate = text.split('if [[ "$pi_physically_isolated" == true ]]; then', 1)[1].split('\nfenced=true', 1)[0]
        with tempfile.TemporaryDirectory() as work:
            report = Path(work) / "report.json"
            report.write_text('{"checks":[]}')
            script = '''set -euo pipefail
dr_die() { echo "$*" >&2; exit 1; }
dr_sign_file() { cp "$3" "$4"; }
DR_COMPLETION_SIGNING_KEY=unused
report="$1"
if true; then
''' + gate
            result = subprocess.run(["bash", "-c", script, "test", str(report)],
                input=phrase + "\n", text=True, capture_output=True)
            return result.returncode, json.loads(report.read_text()), Path(str(report) + ".sig").exists()

    def test_wrong_phrase_does_not_record_isolation(self):
        code, report, signed = self.run_gate("yes")
        self.assertNotEqual(code, 0)
        self.assertEqual(report["checks"], [])
        self.assertFalse(signed)

    def test_explicit_attestation_is_signed_and_distinguishes_method(self):
        code, report, signed = self.run_gate("PI POWER AND ETHERNET DISCONNECTED")
        self.assertEqual(code, 0)
        self.assertTrue(signed)
        evidence = report["checks"][0]["evidence"]
        self.assertEqual(evidence["method"], "operator-physical-disconnection")
        self.assertTrue(evidence["powerDisconnected"])
        self.assertTrue(evidence["ethernetDisconnected"])
        self.assertTrue(evidence["remainDisconnectedUntilFailback"])


if __name__ == "__main__":
    unittest.main()
