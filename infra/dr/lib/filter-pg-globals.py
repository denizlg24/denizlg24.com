#!/usr/bin/env python3
"""Skip only canonical CREATE ROLE statements for roles already on target."""
import argparse
import json
import sys


def filter_globals(existing_creates, lines):
    if not isinstance(existing_creates, list) or not existing_creates or any(
        not isinstance(s, str) or not s.startswith("CREATE ROLE ") or not s.endswith(";")
        or "\n" in s or "\r" in s for s in existing_creates
    ):
        raise ValueError("invalid canonical PostgreSQL role inventory")
    existing = set(existing_creates)
    for line in lines:
        if line.rstrip("\n") not in existing:
            yield line


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--roles", required=True)
    args = parser.parse_args()
    try:
        with open(args.roles) as source:
            roles = json.load(source)
        sys.stdout.writelines(filter_globals(roles, sys.stdin))
    except (OSError, ValueError) as error:
        sys.exit("STOP: " + str(error))
