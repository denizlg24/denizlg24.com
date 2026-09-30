import unittest

from scripts.ci.select_checks import select


class SelectChecksTest(unittest.TestCase):
    def test_python_only(self):
        self.assertEqual(
            select(["apps/macros-vision/service.py"]),
            {"build": False, "full_js": False, "macros_db": False, "macros_vision": True, "envoy_cli": False, "workflow_lint": False},
        )

    def test_database_and_javascript(self):
        checks = select(["apps/macros/db/schema/definitions.ts"])
        self.assertTrue(checks["build"])
        self.assertFalse(checks["full_js"])
        self.assertTrue(checks["macros_db"])
        self.assertFalse(checks["macros_vision"])

    def test_bun_lockfile_skips_python_and_rust(self):
        checks = select(["bun.lock"])
        self.assertTrue(checks["build"])
        self.assertTrue(checks["full_js"])
        self.assertTrue(checks["macros_db"])
        self.assertFalse(checks["macros_vision"])
        self.assertFalse(checks["envoy_cli"])
        self.assertFalse(checks["workflow_lint"])

    def test_ci_workflow_change_runs_all(self):
        self.assertTrue(all(select([".github/workflows/ci.yml"]).values()))

    def test_workflow_change_lints_workflows(self):
        checks = select([".github/workflows/release-cloud.yml"])
        self.assertTrue(checks["workflow_lint"])
        self.assertFalse(checks["build"])

    def test_ci_script_runs_its_own_tests_only(self):
        self.assertFalse(any(select(["scripts/ci/select_checks.py"]).values()))

    def test_root_script_runs_full_javascript(self):
        checks = select(["scripts/clean-next-dev-types.mjs"])
        self.assertTrue(checks["build"])
        self.assertTrue(checks["full_js"])

    def test_docs_only_runs_none(self):
        self.assertFalse(any(select(["docs/guide.md"]).values()))


if __name__ == "__main__":
    unittest.main()
