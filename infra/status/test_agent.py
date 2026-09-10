import importlib.util
import json
import plistlib
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

    def test_mac_run_signals_the_existing_menu_process(self):
        with tempfile.TemporaryDirectory() as directory:
            plist = Path(directory) / "menu.plist"
            with plist.open("wb") as stream:
                plistlib.dump({"ProgramArguments": ["/installed/dr-menubar", "--interval", "3600",
                    "--schedule-enabled", "true"]}, stream)
            instance = agent.Agent.__new__(agent.Agent)
            with patch.object(instance, "mac_plist", return_value=plist), \
                 patch.object(agent, "command", side_effect=[Mock(stdout="\n\tpid = 123\n"), Mock(stdout="")]) as execute:
                detail = instance.execute_mac({"job": "icloud", "action": "run"})
            self.assertIn("menu bar app", detail)
            self.assertEqual(execute.call_args_list[-1].args[0][1:3], ["kill", "SIGUSR1"])

    def test_mac_run_waits_for_a_started_menu_before_signalling(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plist = root / "menu.plist"
            with plist.open("wb") as stream:
                plistlib.dump({"ProgramArguments": ["/installed/dr-menubar"]}, stream)
            menu_state = root / "menubar.json"
            calls = []

            def launchctl(argv, check=True):
                calls.append(argv[1])
                if argv[1] == "kickstart":
                    menu_state.write_text("{}")
                return Mock(stdout="")

            instance = agent.Agent.__new__(agent.Agent)
            instance.config = {"drMenuStatePath": str(menu_state)}
            with patch.object(instance, "mac_plist", return_value=plist), \
                 patch.object(agent, "command", side_effect=launchctl):
                instance.execute_mac({"job": "icloud", "action": "run"})
            self.assertEqual(calls, ["print", "kickstart", "kill"])

    def test_mac_schedule_is_refused_while_a_menu_task_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plist = root / "menu.plist"
            with plist.open("wb") as stream:
                plistlib.dump({"ProgramArguments": ["/installed/dr-menubar", "--interval", "3600",
                    "--schedule-enabled", "true"]}, stream)
            original = plist.read_bytes()
            menu_state = root / "menubar.json"
            menu_state.write_text(json.dumps({"activeJobs": [{"command": "cycle", "profile": "pi"}]}))
            instance = agent.Agent.__new__(agent.Agent)
            instance.config = {"drMenuStatePath": str(menu_state)}
            with patch.object(instance, "mac_plist", return_value=plist), patch.object(agent, "command") as execute:
                with self.assertRaisesRegex(RuntimeError, "task is running"):
                    instance.execute_mac({"job": "icloud", "action": "schedule", "schedule": "7200", "enabled": True})
            execute.assert_not_called()
            self.assertEqual(plist.read_bytes(), original)

    def test_mac_schedule_keeps_menu_available_when_automatic_copies_are_paused(self):
        with tempfile.TemporaryDirectory() as directory:
            plist = Path(directory) / "menu.plist"
            with plist.open("wb") as stream:
                plistlib.dump({"ProgramArguments": ["/installed/dr-menubar", "--interval", "3600",
                    "--schedule-enabled", "true"], "Disabled": False}, stream)
            instance = agent.Agent.__new__(agent.Agent)
            instance.config = {"drMenuStatePath": str(Path(directory) / "menubar.json")}
            with patch.object(instance, "mac_plist", return_value=plist), patch.object(agent, "command") as execute:
                instance.execute_mac({"job": "icloud", "action": "schedule", "schedule": "7200", "enabled": False})
            with plist.open("rb") as stream:
                settings = plistlib.load(stream)
            arguments = settings["ProgramArguments"]
            self.assertEqual(arguments[arguments.index("--interval") + 1], "7200")
            self.assertEqual(arguments[arguments.index("--schedule-enabled") + 1], "false")
            self.assertFalse(settings["Disabled"])
            self.assertEqual(execute.call_args_list[-1].args[0][1], "enable")

    def test_mac_tick_reports_menu_state(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            menu_state = root / "menubar.json"
            report = {"job": "icloud", "runId": "2026-09-10T10:00:00Z", "status": "completed",
                "startedAt": "2026-09-10T10:00:00Z", "completedAt": "2026-09-10T10:01:00Z",
                "lastSuccessAt": "2026-09-10T10:01:00Z", "nextRunAt": None, "durationMs": 60000,
                "sizeBytes": None, "enabled": True, "schedule": "3600", "detail": "done", "verification": "checked"}
            menu_state.write_text(json.dumps({"report": report, "scheduleEnabled": False,
                "intervalSeconds": 7200, "nextRunAt": None}))
            instance = agent.Agent.__new__(agent.Agent)
            instance.profile = "mac"
            instance.state = root / "status"
            instance.state.mkdir()
            instance.config = {"drMenuStatePath": str(menu_state)}
            instance.post = Mock(side_effect=[{}, {"command": None}])
            instance.tick()
            posted = instance.post.call_args_list[0].args[0]["report"]
            self.assertFalse(posted["enabled"])
            self.assertEqual(posted["schedule"], "7200")

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
