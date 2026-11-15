import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("pg_globals", Path(__file__).parents[1] / "lib/filter-pg-globals.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class GlobalRoleRetryTests(unittest.TestCase):
    def test_skip_existing_creates_but_preserve_all_alters_and_grants(self):
        roles = ['CREATE ROLE postgres;', 'CREATE ROLE "project-role";']
        lines = ['CREATE ROLE postgres;\n', 'CREATE ROLE "project-role";\n',
                 'ALTER ROLE "project-role" WITH LOGIN;\n', 'GRANT reader TO "project-role";\n',
                 'CREATE ROLE new_role;\n']
        self.assertEqual(list(module.filter_globals(roles, lines)), lines[2:])

    def test_exact_statements_only(self):
        lines = ['-- CREATE ROLE postgres;\n', 'CREATE ROLE postgresql;\n', 'CREATE ROLE postgres;\n']
        self.assertEqual(list(module.filter_globals(['CREATE ROLE postgres;'], lines)), lines[:2])

    def test_reject_empty_or_ambiguous_inventory(self):
        for roles in [[], ['CREATE ROLE "a\nb";'], ['DROP ROLE postgres;'], None]:
            with self.subTest(roles=roles), self.assertRaises(ValueError):
                list(module.filter_globals(roles, ['CREATE ROLE new_role;\n']))


if __name__ == "__main__":
    unittest.main()
