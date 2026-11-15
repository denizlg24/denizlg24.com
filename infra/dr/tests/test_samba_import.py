import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location('samba_import', Path(__file__).parents[1] / 'lib/remap-samba-passdb.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SambaImportTests(unittest.TestCase):
    def test_credentials_and_flags_survive_uid_remapping(self):
        source = 'deniz-api-broker:995:' + 'X'*32 + ':' + 'A'*32 + ':[U          ]:LCT-12345678:\n'
        result = list(module.remap([source], lambda name: SimpleNamespace(pw_uid=994)))
        self.assertEqual(result, [source.rstrip('\n').replace(':995:', ':994:', 1)])

    def test_unknown_accounts_fail_before_output(self):
        source = 'root:0:' + 'X'*32 + ':' + 'A'*32 + ':[U          ]:LCT-12345678:\n'
        with self.assertRaises(ValueError): list(module.remap([source]))

    def test_invalid_export_is_rejected(self):
        with self.assertRaises(ValueError): list(module.remap(['deniz-api-broker:995:broken']))

if __name__ == '__main__': unittest.main()
