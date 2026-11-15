#!/usr/bin/env python3
"""Bind portable numeric ACL checks to the authenticated namespace archives."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile


def acl_text(member):
    access = member.pax_headers.get("SCHILY.acl.access")
    if access is None:
        def permissions(bits):
            return "".join(char if bits & mask else "-" for char, mask in (("r", 4), ("w", 2), ("x", 1)))
        access = f"user::{permissions((member.mode >> 6) & 7)}\ngroup::{permissions((member.mode >> 3) & 7)}\nother::{permissions(member.mode & 7)}"
    lines = []
    for prefix, text in (("", access), ("default:", member.pax_headers.get("SCHILY.acl.default", ""))):
        for line in text.splitlines():
            if not re.fullmatch(r"(?:user|group|mask|other):[0-9]*:[r-][w-][x-]", line):
                raise ValueError("archive ACL is not numeric POSIX metadata")
            lines.append(prefix + line)
    return "\n".join(lines) + "\n\n"


def enrich(backup):
    rows = [json.loads(line) for line in (backup / "manifest.jsonl").read_text().splitlines() if line]
    expected = {(row["branch"], row["relativePath"]): row for row in rows}
    for role in ("ssd", "hdd", "object-store"):
        archive = backup / (role + ".tar")
        process = None
        if archive.exists():
            source = tarfile.open(archive, "r:")
        else:
            process = subprocess.Popen(["zstd", "-dc", str(archive) + ".zst"], stdout=subprocess.PIPE)
            source = tarfile.open(fileobj=process.stdout, mode="r|")
        with source:
            for member in source:
                # GNU sparse PAX members can also carry a non-ASCII `path`.
                # Python may expose that temporary GNUSparseFile name while
                # GNU tar restores the authoritative GNU.sparse.name instead.
                name = member.pax_headers.get("GNU.sparse.name", member.name)
                relative = name.removeprefix("./") or "."
                row = expected.get((role, relative))
                if row is not None:
                    row["archiveAclHash"] = hashlib.sha256(acl_text(member).encode()).hexdigest()
        if process and process.wait() != 0:
            raise ValueError("cannot read compressed ACL source")
    if any("archiveAclHash" not in row for row in rows):
        raise ValueError("namespace manifest entry has no archive ACL source")
    for row in rows:
        print(json.dumps(row, separators=(",", ":")))


if __name__ == "__main__":
    try:
        enrich(Path(sys.argv[1]))
    except (ValueError, OSError, tarfile.TarError) as error:
        sys.exit("STOP: " + str(error))
