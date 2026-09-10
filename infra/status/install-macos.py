#!/usr/bin/env python3
"""Install status reporting for the DR menu bar app."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dr-config", required=True, type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    if sys.platform != "darwin":
        raise ValueError("macOS required")
    token = os.environ["STATUS_AGENT_MAC_TOKEN"]
    if len(token) < 32:
        raise ValueError("STATUS_AGENT_MAC_TOKEN is missing or too short")
    if not args.dr_config.is_absolute() or args.dr_config.is_symlink() or args.dr_config.stat().st_mode & 0o077:
        raise ValueError("DR config must be an absolute private regular file")
    root = Path.home() / "Library/Application Support/deniz-status"
    launch_agents = Path.home() / "Library/LaunchAgents"
    config_root = Path.home() / ".config/deniz-status"
    log_root = Path.home() / "Library/Logs/deniz-status"
    cycle_plist = launch_agents / "com.denizlg24.dr-sync.plist"
    with cycle_plist.open("rb") as stream:
        cycle = plistlib.load(stream)
    cycle_arguments = cycle.get("ProgramArguments", [])
    if not cycle_arguments or Path(cycle_arguments[0]).name != "dr-menubar":
        raise ValueError("Install the current DR menu bar app before status reporting")
    for directory in (root, launch_agents, config_root, log_root):
        if any(p.is_symlink() for p in [directory, *directory.parents]):
            raise ValueError("refusing a symlinked installation directory")
        directory.mkdir(parents=True, mode=0o700, exist_ok=True)
    executable = root / "agent.py"
    config = config_root / "agent.json"
    tick_plist = launch_agents / "com.denizlg24.status-agent.plist"
    for target in (executable, config, cycle_plist, tick_plist):
        if target.is_symlink():
            raise ValueError("refusing a symlinked installation file")
    shutil.copyfile(Path(__file__).with_name("agent.py"), executable)
    executable.chmod(0o700)
    config.write_text(json.dumps({"profile": "mac", "url": "https://status.denizlg24.com", "token": token,
        "stateDirectory": str(root), "drSyncPath": str(Path.home() / "Library/Application Support/deniz-dr/macos/dr-r2"),
        "drConfigPath": str(args.dr_config),
        "drMenuStatePath": str(Path.home() / "Library/Application Support/deniz-dr/menubar-state.json"),
        "icloudCycleTimeoutSeconds": 172800}))
    config.chmod(0o600)
    arguments = [sys.executable, str(executable), "--config", str(config)]
    tick = {"Label": "com.denizlg24.status-agent", "ProgramArguments": arguments,
            "StartInterval": 60, "RunAtLoad": True,
            "EnvironmentVariables": cycle.get("EnvironmentVariables", {}),
            "StandardOutPath": str(log_root / "agent.log"),
            "StandardErrorPath": str(log_root / "agent.error.log")}
    domain = f"gui/{os.getuid()}"
    for path, settings in ((tick_plist, tick),):
        label = domain + "/" + settings["Label"]
        subprocess.run(["launchctl", "bootout", label], capture_output=True)
        with path.open("wb") as stream:
            plistlib.dump(settings, stream)
        path.chmod(0o600)
        subprocess.run(["launchctl", "enable", label], check=True)
        subprocess.run(["launchctl", "bootstrap", domain, str(path)], check=True)
    print("Installed Mac status reporting every minute for the DR menu bar app.")


if __name__ == "__main__":
    main()
