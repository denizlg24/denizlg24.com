"""Resolve exact source package versions against the reviewed target baseline."""
import hashlib
import json
from pathlib import Path
import re
import sys

POLICY = Path(__file__).resolve().parents[1] / "config/recovery-packages.json"


def resolve(inventories, policy=None):
    policy = policy or json.loads(POLICY.read_bytes())
    if policy.get("schemaVersion") != 1 or policy.get("ubuntu") != "24.04" or policy.get("architecture") != "x86_64":
        raise ValueError("unsupported recovery package baseline")
    packages = {}
    for inventory in inventories:
        if not isinstance(inventory, dict) or not inventory:
            raise ValueError("empty or invalid package inventory")
        for name, source in inventory.items():
            if not re.fullmatch(r"[a-z0-9][a-z0-9+.-]*", name) or not isinstance(source, str) or not re.fullmatch(r"[A-Za-z0-9.+:~_-]+", source):
                raise ValueError("invalid captured package identity")
            override = policy["overrides"].get(name)
            target = source
            if override:
                target = override["targetVersion"]
                if source not in override["acceptedSourceVersions"] or target not in override["acceptedSourceVersions"]:
                    raise ValueError(f"unreviewed source version for {name}: {source}")
            if name in packages and packages[name] != target:
                raise ValueError(f"unreviewed package disagreement: {name}")
            packages[name] = target
    return dict(sorted(packages.items()))


def policy_hash():
    return hashlib.sha256(POLICY.read_bytes()).hexdigest()


if __name__ == "__main__":
    try:
        print(json.dumps(resolve([json.loads(Path(p).read_bytes()) for p in sys.argv[1:]]), sort_keys=True))
    except (ValueError, KeyError, OSError) as error:
        sys.exit(f"STOP: {error}")
