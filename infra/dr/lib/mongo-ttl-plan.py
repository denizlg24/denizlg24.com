#!/usr/bin/env python3
"""Plan only TTL expirations that explain a legacy signed backup baseline."""
import argparse
import copy
import datetime as dt
import hashlib
import json
from pathlib import Path
import re


def plan(expected, actual, captured_at):
    normalized = copy.deepcopy(actual)
    changes = []
    if len(expected["databases"]) != len(actual["databases"]):
        raise ValueError("database inventory differs")
    for ed, ad in zip(expected["databases"], normalized["databases"]):
        if ed["name"] != ad["name"] or len(ed["collections"]) != len(ad["collections"]):
            raise ValueError("collection inventory differs")
        for ec, ac in zip(ed["collections"], ad["collections"]):
            if ec == ac:
                continue
            if {k: v for k, v in ec.items() if k != "documents"} != {k: v for k, v in ac.items() if k != "documents"}:
                raise ValueError("non-TTL collection metadata differs")
            if not isinstance(ac["documents"], int) or not isinstance(ec["documents"], int) or ac["documents"] <= ec["documents"]:
                raise ValueError("missing documents cannot be explained by TTL")
            indexes = [i for i in ec["indexes"] if isinstance(i.get("expireAfterSeconds"), (int, float)) and i["expireAfterSeconds"] >= 0]
            if len(indexes) != 1 or len(indexes[0]["key"]) != 1 or ec["name"].startswith("system."):
                raise ValueError("difference has no unambiguous TTL index")
            index = indexes[0]
            field = next(iter(index["key"]))
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", field):
                raise ValueError("unsafe TTL field")
            changes.append({"database": ed["name"], "collection": ec["name"], "before": ac["documents"],
                            "expected": ec["documents"], "index": index, "field": field})
            ac["documents"] = ec["documents"]
    if normalized != expected:
        raise ValueError("users, roles or other semantic evidence differs")
    return {"capturedAt": captured_at, "collections": changes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("expected", "actual", "manifest"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    expected_path = Path(args.expected)
    manifest = json.loads(Path(args.manifest).read_text())
    captured = dt.datetime.fromtimestamp(expected_path.stat().st_mtime, dt.timezone.utc)
    started = dt.datetime.strptime(manifest["snapshotId"].rsplit("-", 1)[1], "%Y%m%dT%H%M%SZ").replace(tzinfo=dt.timezone.utc)
    completed = dt.datetime.fromisoformat(manifest["createdAt"].replace("Z", "+00:00"))
    if not started <= captured <= completed:
        raise SystemExit("STOP: semantic file timestamp is outside the authenticated backup window")
    try:
        result = plan(json.loads(expected_path.read_text()), json.loads(Path(args.actual).read_text()), captured.isoformat())
        result.update(snapshotId=manifest["snapshotId"], expectedSha256=hashlib.sha256(expected_path.read_bytes()).hexdigest())
        print(json.dumps(result))
    except (ValueError, KeyError) as error:
        raise SystemExit("STOP: " + str(error))
