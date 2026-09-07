import importlib.util
import json
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch, Mock

spec = importlib.util.spec_from_file_location("status_agent", Path(__file__).with_name("agent.py"))
agent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(agent)
ID = "d404f213-01af-4255-805c-2b513b13ea76"


class AgentTests(unittest.TestCase):
    def test_cross_host_and_shell_input_are_rejected(self):
        for value in (
            {"id": ID, "job": "icloud", "action": "run"},
            {"id": ID, "job": "backup", "action": "schedule", "schedule": "daily\n[Service]\nExecStart=evil", "enabled": True},
            {"id": ID, "job": "backup", "action": "schedule", "schedule": "$(touch /tmp/evil)", "enabled": True},
            {"id": ID, "job": "backup", "action": "execute"},
        ):
            with self.assertRaises(ValueError):
                agent.validate_command(value, "pi")

    def test_running_job_is_never_restarted(self):
        instance = agent.Agent.__new__(agent.Agent)
        instance.profile = "pi"
        with patch.object(agent, "properties", return_value={"LoadState": "loaded", "ActiveState": "activating"}), patch.object(agent, "command") as execute:
            with self.assertRaises(RuntimeError):
                instance.execute_linux({"job": "backup", "action": "run"})
            execute.assert_not_called()

    def test_never_executed_is_not_reported_as_completed(self):
        instance = agent.Agent.__new__(agent.Agent)
        instance.profile = "forge"
        instance.post = Mock()
        with patch.object(agent, "properties", return_value={"LoadState": "loaded"}):
            instance.report_linux("backup")
        instance.post.assert_not_called()

    def test_failed_run_retains_last_success(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = agent.Agent.__new__(agent.Agent)
            instance.profile = "pi"
            instance.state = Path(directory)
            instance.post = Mock()
            agent.atomic_json(instance.state / "backup.json", {"lastSuccessAt": "2026-09-01T10:00:00Z"})
            service = {"LoadState": "loaded", "ActiveState": "failed", "Result": "exit-code", "ExecMainStatus": "1", "ExecMainStartTimestamp": "start", "ExecMainExitTimestamp": "end"}
            def to_time(value):
                return {"start": "2026-09-02T10:00:00Z", "end": "2026-09-02T10:10:00Z"}.get(value)
            with patch.object(agent, "properties", return_value=service), patch.object(agent, "timestamp", side_effect=to_time), patch.object(agent, "job_evidence", return_value={}):
                instance.report_linux("backup")
            report = instance.post.call_args[0][0]["report"]
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["lastSuccessAt"], "2026-09-01T10:00:00Z")
            self.assertEqual(report["durationMs"], 600000)
            self.assertIsNone(report["verification"])

    def test_journal_only_forwards_bounded_structured_measurements(self):
        lines = ['Authorization: Bearer secret', 'DR_STATUS {"phase":"preflight"}', 'DR_STATUS {"phase":"restic-backup","sizeBytes":1024,"token":"secret"}', 'DR_STATUS invalid', 'DR_STATUS {"newBytes":-1,"imageBytes":true,"repositoryBytes":1e999}']
        output = "\n".join(json.dumps({"__REALTIME_TIMESTAMP": str(index), "MESSAGE": line}) for index, line in reversed(list(enumerate(lines))))
        with patch.object(agent, "command", return_value=Mock(stdout=output)) as execute:
            evidence = agent.job_evidence("deniz-dr-backup@forge", "2026-09-07T10:00:00Z", "2026-09-07T10:00:00Z")
        self.assertEqual(evidence, {"phase": "restic-backup", "sizeBytes": 1024})
        self.assertIn("--until", execute.call_args[0][0])
        self.assertIn("2026-09-07T10:00:01+00:00", execute.call_args[0][0])

    def test_skipped_run_cannot_refresh_last_success(self):
        with tempfile.TemporaryDirectory() as directory:
            instance = agent.Agent.__new__(agent.Agent)
            instance.profile = "forge"
            instance.state = Path(directory)
            instance.post = Mock()
            previous = "2026-09-01T10:00:00Z"
            agent.atomic_json(instance.state / "r2-sync.json", {"lastSuccessAt": previous,
                "lastVerified": {"capturedAt": previous, "snapshotCount": 4}})
            service = {"LoadState": "loaded", "ActiveState": "inactive", "Result": "success", "ExecMainStatus": "0", "ExecMainStartTimestamp": "start", "ExecMainExitTimestamp": "end"}
            times = {"start": "2026-09-02T10:00:00Z", "end": "2026-09-02T10:01:00Z"}
            with patch.object(agent, "properties", return_value=service), patch.object(agent, "timestamp", side_effect=times.get), patch.object(agent, "job_evidence", return_value={"phase": "skipped", "reason": "host-lock-held"}):
                instance.report_linux("r2-sync")
            report = instance.post.call_args[0][0]["report"]
            self.assertEqual(report["lastSuccessAt"], previous)
            self.assertEqual(report["runId"], times["start"])
            self.assertIn('"snapshotCount":4', report["detail"])
            self.assertNotIn("lastVerified", report)  # Legacy wire schema stays valid.


if __name__ == "__main__":
    unittest.main()
