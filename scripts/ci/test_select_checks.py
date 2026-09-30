import unittest

from scripts.ci.select_checks import select


class SelectChecksTest(unittest.TestCase):
    def test_python_only(self):
        self.assertEqual(
            select(["apps/macros-vision/service.py"]),
            {"build": False, "full_js": False, "macros_db": False, "macros_vision": True, "email_classifier": False, "sandbox_runtime": False, "envoy_cli": False, "ssh_server": False, "workflow_lint": False},
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
        self.assertFalse(checks["email_classifier"])
        self.assertFalse(checks["sandbox_runtime"])
        self.assertFalse(checks["envoy_cli"])
        self.assertFalse(checks["ssh_server"])
        self.assertFalse(checks["workflow_lint"])

    def test_non_javascript_apps_use_their_own_checks(self):
        cases = {
            "apps/email-classifier/main.py": "email_classifier",
            "apps/ssh-server/main.go": "ssh_server",
            "apps/sandbox/runtime/sandbox-file.py": "sandbox_runtime",
            "apps/sandbox/runtime.Dockerfile": "sandbox_runtime",
        }
        for path, expected in cases.items():
            with self.subTest(path=path):
                checks = select([path])
                self.assertTrue(checks[expected])
                self.assertFalse(checks["build"])
                self.assertEqual(sum(checks.values()), 1)

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
