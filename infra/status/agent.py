#!/usr/bin/env python3
"""Report DR jobs and execute a small, fixed set of authenticated commands.
No shell commands or executable paths are accepted from the status server.
"""
import argparse
import datetime as dt
import fcntl
import json
import math
import os
from pathlib import Path
import plistlib
import re
import subprocess
import sys
import time
import urllib.request

JOBS = ("backup", "r2-sync", "r2-retention")
UTC = dt.timezone.utc


def now():
    return dt.datetime.now(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def atomic_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_suffix(".tmp")
    with temporary.open("w") as stream:
        os.chmod(temporary, 0o600)
        json.dump(data, stream)
    temporary.replace(path)


def load_json(path, default=None):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def command(argv, check=True, timeout=25):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout, env={**os.environ, "LC_ALL": "C", "TZ": "UTC"})
    if check and result.returncode:
        raise RuntimeError(f"{Path(argv[0]).name} failed with exit code {result.returncode}")
    return result


def timestamp(value):
    if not value or value in ("n/a", "0"):
        return None
    result = command(["date", "--date", value, "+%s"], check=False)
    if result.returncode:
        return None
    return dt.datetime.fromtimestamp(int(result.stdout.strip()), UTC).isoformat().replace("+00:00", "Z")


def properties(unit):
    result = command(["systemctl", "show", unit, "--no-pager"])
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def job_evidence(unit, start, end):
    """Read only explicitly published metrics, never forward arbitrary logs."""
    args = ["journalctl", "-u", f"{unit}.service", "--since", start,
            "--no-pager", "-o", "json", "--grep", "^DR_STATUS ", "-n", "200"]
    if end:
        # systemctl's printable timestamp has second precision. Include that
        # entire second or fast jobs lose their final measurements.
        until = dt.datetime.fromisoformat(end.replace("Z", "+00:00")) + dt.timedelta(seconds=1)
        args += ["--until", until.isoformat()]
    output = command(args, check=False).stdout
    result = {}
    numeric = {"sizeBytes", "newBytes", "artifactBytes", "restoredBytes", "imageBytes",
               "repositoryBytes", "deploymentCount", "snapshotCount", "snapshotsCopied", "snapshotsRemoved"}
    records = []
    for entry in output.splitlines():
        try:
            record = json.loads(entry)
            records.append((int(record["__REALTIME_TIMESTAMP"]), record["MESSAGE"]))
        except (ValueError, KeyError, TypeError):
            continue
    # --grep with --lines returns newest first on some systemd versions.
    # Merge in journal timestamp order, so an early phase cannot win.
    for _, line in sorted(records, key=lambda record: record[0]):
        if not isinstance(line, str):
            continue
        if not line.startswith("DR_STATUS "):
            continue
        try:
            data = json.loads(line[10:])
        except ValueError:
            continue
        if not isinstance(data, dict):
            continue
        for key, value in data.items():
            if key in numeric and type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 2**53 - 1:
                result[key] = value
            elif key in ("phase", "reason", "snapshotId", "verification") and isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_-]{1,160}", value):
                result[key] = value
            elif key == "capturedAt" and isinstance(value, str):
                try:
                    parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
                    if parsed.tzinfo:
                        result[key] = parsed.isoformat()
                except ValueError:
                    pass
    return result


def validate_command(data, profile):
    if not isinstance(data, dict) or not re.fullmatch(r"[a-f0-9-]{36}", data.get("id", "")):
        raise ValueError("Invalid command id")
    if data.get("job") not in (("icloud",) if profile == "mac" else JOBS):
        raise ValueError("Job is not allowed on this host")
    if data.get("action") not in ("run", "schedule"):
        raise ValueError("Action is not allowed")
    if data["action"] == "schedule":
        schedule = data.get("schedule")
        if not isinstance(schedule, str) or not re.fullmatch(r"[A-Za-z0-9*,:/ .+~_-]{1,160}", schedule):
            raise ValueError("Invalid calendar expression")
        if not isinstance(data.get("enabled"), bool):
            raise ValueError("Enabled must be a boolean")
        if profile == "mac" and (not schedule.isdigit() or not 300 <= int(schedule) <= 604800):
            raise ValueError("iCloud interval must be 300–604800 seconds")
    return data


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


class Agent:
    def __init__(self, config_path):
        self.config_path = Path(config_path).resolve()
        if self.config_path.stat().st_mode & 0o077 or self.config_path.stat().st_uid != os.getuid():
            raise ValueError("Configuration must be owned by the agent user and mode 0600")
        self.config = load_json(self.config_path)
        self.profile = self.config["profile"]
        if self.profile not in ("pi", "forge", "mac"):
            raise ValueError("Invalid profile")
        self.url = self.config["url"].rstrip("/")
        if not self.url.startswith("https://") or len(self.config["token"]) < 32:
            raise ValueError("An HTTPS URL and a token of at least 32 characters are required")
        self.state = Path(self.config.get("stateDirectory", "/var/lib/deniz-status" if self.profile != "mac" else str(Path.home() / "Library/Application Support/deniz-status")))
        self.state.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.opener = urllib.request.build_opener(NoRedirect)

    def post(self, body):
        request = urllib.request.Request(f"{self.url}/api/agent/{self.profile}", data=json.dumps(body).encode(), headers={"Authorization": f"Bearer {self.config['token']}", "Content-Type": "application/json"}, method="POST")
        with self.opener.open(request, timeout=15) as response:
            return json.load(response)

    def report_linux(self, job):
        unit = f"deniz-dr-{job}@{self.profile}"
        service = properties(f"{unit}.service")
        timer = properties(f"{unit}.timer")
        if service.get("LoadState") != "loaded":
            return
        start = timestamp(service.get("ExecMainStartTimestamp"))
        if not start:
            return  # Never run is unmeasured, not completed.
        running = service.get("ActiveState") in ("activating", "active", "deactivating")
        end = None if running else timestamp(service.get("ExecMainExitTimestamp"))
        if not running and not end:
            return
        succeeded = not running and service.get("Result") == "success" and service.get("ExecMainStatus") == "0"
        state = load_json(self.state / f"{job}.json", {})
        evidence = job_evidence(unit, start, end)
        skipped = evidence.get("phase") == "skipped"
        success = end if succeeded and not skipped else state.get("lastSuccessAt")
        last_verified = state.get("lastVerified")
        if succeeded and evidence.get("verification"):
            last_verified = {**evidence, "completedAt": end}
        if last_verified:
            evidence["lastVerified"] = last_verified
        override = Path(f"/etc/systemd/system/{unit}.timer.d/status.conf")
        schedule = None
        if override.exists():
            schedule = next((line[11:] for line in override.read_text().splitlines() if line.startswith("OnCalendar=") and len(line) > 11), None)
        if not schedule:
            # TimersCalendar is systemd's normalized, currently loaded schedule.
            schedule = timer.get("TimersCalendar") or None
        data = {
            # InvocationID disappears once some systemd versions unload a
            # oneshot. Start time remains the same through every state.
            "job": job, "runId": start,
            "status": "running" if running else "completed" if succeeded else "failed",
            "startedAt": start, "completedAt": end, "lastSuccessAt": success,
            "nextRunAt": timestamp(timer.get("NextElapseUSecRealtime")),
            "durationMs": None if not end else max(0, int((dt.datetime.fromisoformat(end.replace("Z", "+00:00")) - dt.datetime.fromisoformat(start.replace("Z", "+00:00"))).total_seconds() * 1000)),
            "sizeBytes": evidence.get("sizeBytes"), "enabled": timer.get("ActiveState") == "active", "schedule": schedule,
            "detail": f"systemd: {service.get('ActiveState')}; result: {service.get('Result')}; exit: {service.get('ExecMainStatus')}\n"
                      + (f"Stopped during {evidence.get('phase', 'unreported phase')}. Inspect this invocation in the host journal.\n" if not running and not succeeded else "")
                      + "DR_STATUS " + json.dumps(evidence, separators=(",", ":")),
            "verification": ("Skipped: " + evidence.get("reason", "no work performed")) if skipped else
                "The guarded job completed. Repository checking and signed publication are separate from a full recovery rehearsal." if succeeded else None,
        }
        atomic_json(self.state / f"{job}.json", {**data, "lastVerified": last_verified})
        self.post({"type": "report", "report": data})

    def execute_linux(self, data):
        unit = f"deniz-dr-{data['job']}@{self.profile}"
        service = properties(f"{unit}.service")
        if service.get("LoadState") != "loaded":
            raise RuntimeError("The recovery service is not installed")
        if service.get("ActiveState") in ("activating", "active", "deactivating"):
            raise RuntimeError("The job is running; wait for completion before changing it")
        if data["action"] == "run":
            command(["systemctl", "start", "--no-block", f"{unit}.service"])
            return "Start accepted by systemd. The backup report tracks actual completion."
        command(["systemd-analyze", "calendar", "--", data["schedule"]])
        parent = Path(f"/etc/systemd/system/{unit}.timer.d")
        if parent.is_symlink():
            raise RuntimeError("Refusing a symlinked timer directory")
        parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        path = parent / "status.conf"
        if path.is_symlink():
            raise RuntimeError("Refusing a symlinked drop-in")
        original = path.read_text() if path.exists() else None
        temporary = parent / ".status.conf.tmp"
        temporary.write_text(f"[Timer]\nOnCalendar=\nOnCalendar={data['schedule']}\n")
        temporary.replace(path)
        try:
            command(["systemctl", "daemon-reload"])
            command(["systemctl", "enable" if data["enabled"] else "disable", "--now", f"{unit}.timer"])
            if data["enabled"]:
                command(["systemctl", "restart", f"{unit}.timer"])
        except Exception:
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_text(original)
            command(["systemctl", "daemon-reload"], check=False)
            raise
        return "Timer schedule updated. Existing backup safeguards remain enabled."

    def mac_plist(self):
        return Path.home() / "Library/LaunchAgents/com.denizlg24.dr-sync.plist"

    def execute_mac(self, data):
        path = self.mac_plist()
        if not path.exists():
            raise RuntimeError("Install the iCloud status wrapper first")
        label = f"gui/{os.getuid()}/com.denizlg24.dr-sync"
        info = command(["launchctl", "print", label], check=False).stdout
        if re.search(r"^\s*pid = \d+", info, re.M):
            raise RuntimeError("iCloud is running; wait for completion")
        with path.open("rb") as stream:
            settings = plistlib.load(stream)
        if "--icloud-cycle" not in settings.get("ProgramArguments", []):
            raise RuntimeError("Install the reporting wrapper before managing iCloud")
        if data["action"] == "run":
            command(["launchctl", "kickstart", label])
            return "iCloud cycle accepted by launchd. Check the run report for completion."
        settings["StartInterval"] = int(data["schedule"])
        settings["RunAtLoad"] = False
        settings["Disabled"] = not data["enabled"]
        original = path.read_bytes()
        command(["launchctl", "bootout", label], check=False)
        try:
            with path.open("wb") as stream:
                plistlib.dump(settings, stream)
            command(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(path)])
            command(["launchctl", "enable" if data["enabled"] else "disable", label])
        except Exception:
            path.write_bytes(original)
            command(["launchctl", "bootstrap", f"gui/{os.getuid()}", str(path)], check=False)
            raise
        return "iCloud interval updated."

    def icloud_cycle(self):
        path = self.state / "icloud.json"
        previous = load_json(path, {})
        start = now()
        report = {"job": "icloud", "runId": start, "status": "running", "startedAt": start, "completedAt": None, "lastSuccessAt": previous.get("lastSuccessAt"), "nextRunAt": None, "durationMs": None, "sizeBytes": None, "enabled": True, "schedule": "3600", "detail": "Pulling and verifying the independent iCloud copy.", "verification": None}
        atomic_json(path, report)
        executable = Path(self.config["drSyncPath"])
        config = Path(self.config["drConfigPath"])
        if not executable.is_absolute() or not config.is_absolute():
            raise ValueError("Local DR paths must be absolute")
        started = time.monotonic()
        try:
            with (self.state / "icloud.log").open("w") as log:
                result = subprocess.run([str(executable), "--config", str(config), "cycle"], stdout=log, stderr=subprocess.STDOUT, timeout=5 * 3600)
            status = result.returncode
        except Exception:
            status = 1
        report.update(status="completed" if status == 0 else "failed", completedAt=now(), durationMs=int((time.monotonic() - started) * 1000), detail=f"iCloud cycle exited with code {status}; full output is retained on the Mac.")
        if status == 0:
            report["lastSuccessAt"] = report["completedAt"]
            report["verification"] = "The existing iCloud cycle completed its pull, signature validation, and confirmed upload steps."
        atomic_json(path, report)
        return status

    def tick(self):
        with (self.state / "tick.lock").open("w") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return
            failures = []
            for job in (("icloud",) if self.profile == "mac" else JOBS):
                try:
                    if job == "icloud":
                        report = load_json(self.state / "icloud.json")
                        if report:
                            with self.mac_plist().open("rb") as stream:
                                settings = plistlib.load(stream)
                            interval = int(settings.get("StartInterval", 3600))
                            report["enabled"] = not settings.get("Disabled", False)
                            report["schedule"] = str(interval)
                            report["nextRunAt"] = None  # launchd does not expose an exact next-run timestamp.
                            self.post({"type": "report", "report": report})
                    else:
                        self.report_linux(job)
                except Exception as error:
                    failures.append(f"{job}: {type(error).__name__}")
            # Retry acknowledgements, never the already executed operation.
            pending = load_json(self.state / "pending-result.json")
            if pending:
                self.post(pending)
                (self.state / "pending-result.json").unlink()
            claimed = self.post({"type": "claim"}).get("command")
            if claimed:
                try:
                    data = validate_command(claimed, self.profile)
                    detail = self.execute_mac(data) if self.profile == "mac" else self.execute_linux(data)
                    result = {"type": "result", "id": data["id"], "success": True, "detail": detail}
                except Exception as error:
                    result = {"type": "result", "id": claimed["id"], "success": False, "detail": str(error)[:2000]}
                atomic_json(self.state / "pending-result.json", result)
                self.post(result)
                (self.state / "pending-result.json").unlink()
            if failures:
                raise RuntimeError("; ".join(failures))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--icloud-cycle", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    agent = Agent(args.config)
    if args.icloud_cycle:
        if agent.profile != "mac":
            raise ValueError("iCloud cycle is only available on the Mac")
        with (agent.state / "icloud.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return agent.icloud_cycle()
    agent.tick()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Do not print URLs or token-bearing configuration on HTTP failures.
        print(f"Status agent failed: {type(error).__name__}", file=sys.stderr)
        sys.exit(1)
