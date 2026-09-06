import importlib.util
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
            with patch.object(agent, "properties", return_value=service), patch.object(agent, "timestamp", side_effect=to_time):
                instance.report_linux("backup")
            report = instance.post.call_args[0][0]["report"]
            self.assertEqual(report["status"], "failed")
            self.assertEqual(report["lastSuccessAt"], "2026-09-01T10:00:00Z")
            self.assertEqual(report["durationMs"], 600000)
            self.assertIsNone(report["verification"])


if __name__ == "__main__":
    unittest.main()
