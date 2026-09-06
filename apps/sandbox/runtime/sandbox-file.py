#!/usr/bin/env python3
import base64
import json
import os
import pathlib
import sys

ROOT = pathlib.Path("/workspace").resolve()


def safe_path(raw: str, *, existing: bool = False) -> pathlib.Path:
    path = pathlib.Path(raw)
    if not path.is_absolute():
        path = ROOT / path
    resolved = path.resolve(strict=existing)
    if resolved != ROOT and ROOT not in resolved.parents:
        raise ValueError("path leaves /workspace")
    return resolved


def main() -> None:
    operation = sys.argv[1] if len(sys.argv) > 1 else ""
    if operation == "write":
        payload = json.load(sys.stdin)
        written = []
        for file in payload["files"]:
            path = safe_path(file["path"])
            path.parent.mkdir(parents=True, exist_ok=True)
            data = base64.b64decode(file["contentBase64"], validate=True)
            temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
            temporary.write_bytes(data)
            temporary.replace(path)
            written.append(str(path))
        print(json.dumps(written))
        return
    if operation == "list":
        path = safe_path(sys.argv[2], existing=True)
        if not path.is_dir():
            raise ValueError(f'"{path}" is not a directory')
        entries = [
            child.name + ("/" if child.is_dir() else "")
            for child in path.iterdir()
        ]
        print(json.dumps(sorted(entries)))
        return
    if operation == "read":
        path = safe_path(sys.argv[2], existing=True)
        if not path.is_file():
            raise ValueError(f'"{path}" is not a file')
        with path.open("rb") as handle:
            while chunk := handle.read(64 * 1024):
                sys.stdout.buffer.write(chunk)
        return
    raise ValueError("unknown sandbox-file operation")


if __name__ == "__main__":
    main()
