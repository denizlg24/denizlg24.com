import copy
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).parents[1]
script = (ROOT / 'cutover').read_text()
START = "jq -e '\n  (.activeSites"
program = script[script.index(START) + len("jq -e '"):].split("' \"$DR_EXTERNAL_STATE\" >/dev/null", 1)[0]

class CutoverContractTests(unittest.TestCase):
    def setUp(self):
        self.state = json.loads((ROOT / 'external-state.example.json').read_text())

    def accepted(self, state):
        return subprocess.run(['jq', '-e', program], input=json.dumps(state), text=True,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0

    def test_reviewed_example_passes_real_runtime_guard(self):
        self.assertTrue(self.accepted(self.state))

    def test_invalid_hostname_is_rejected(self):
        self.state['records'][0]['publicHostnames'] = ['bad/hostname']
        self.assertFalse(self.accepted(self.state))

    def test_invalid_profile_and_record_kind_are_rejected(self):
        for field, value in (('profiles', ['unreviewed']), ('kind', 'unreviewed')):
            state = copy.deepcopy(self.state)
            state['records'][0][field] = value
            self.assertFalse(self.accepted(state))

if __name__ == '__main__': unittest.main()
