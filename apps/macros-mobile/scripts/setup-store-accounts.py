#!/usr/bin/env python3
"""Set Macros Apple release secrets from a local .env.ios file.

Usage:
  python3 apps/macros-mobile/scripts/setup-store-accounts.py /path/to/.env.ios

Requires GitHub CLI authentication (`gh auth login`) and a Forge superuser
account with a password and TOTP/backup code. For passkey-only accounts, set
FORGE_ACCESS_TOKEN to an API-resource OAuth bearer token before running.
Secrets are sent over HTTPS and are never printed or passed on command lines.
"""

import argparse
import getpass
import http.cookiejar
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.error
import urllib.request


GITHUB_KEYS = (
    "APPLE_TEAM_ID",
    "APPLE_ASC_KEY_ID",
    "APPLE_ASC_ISSUER_ID",
    "APPLE_ASC_PRIVATE_KEY",
    "MACROS_IOS_DIST_CERT_P12",
    "MACROS_IOS_DIST_CERT_PASSWORD",
)
FORGE_KEYS = (
    "MACROS_APNS_KEY_ID",
    "MACROS_APNS_TEAM_ID",
    "MACROS_APNS_PRIVATE_KEY",
    "MACROS_APNS_BUNDLE_ID",
)
API = "https://api.denizlg24.com"
TARGET = "1612bcb0-b068-4b55-9958-42282ea765f7"


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    index = 0
    while index < len(lines):
        line = lines[index].rstrip("\r\n")
        index += 1
        if not line or line.lstrip().startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid .env.ios line {index}")
        key, raw = line.split("=", 1)
        if key in values:
            raise ValueError(f"Duplicate .env.ios key: {key}")
        if raw.startswith('"'):
            chunks = [raw[1:]]
            while not chunks[-1].endswith('"'):
                if index >= len(lines):
                    raise ValueError(f"Unterminated quoted value: {key}")
                chunks.append(lines[index].rstrip("\r\n"))
                index += 1
            chunks[-1] = chunks[-1][:-1]
            value = "\n".join(chunks)
        elif raw.startswith("'") and raw.endswith("'"):
            value = raw[1:-1]
        else:
            value = raw
        values[key] = value
    required = GITHUB_KEYS + FORGE_KEYS
    missing = [key for key in required if not values.get(key)]
    if missing:
        raise ValueError("Missing or empty values: " + ", ".join(missing))
    if values["APPLE_TEAM_ID"] != values["MACROS_APNS_TEAM_ID"]:
        raise ValueError("Apple and APNs Team IDs differ")
    if values["MACROS_APNS_BUNDLE_ID"] != "com.denizlg24.macros":
        raise ValueError("Unexpected APNs bundle ID")
    return values


def request(opener, path: str, method="GET", body=None, token=None):
    headers = {"Accept": "application/json", "Origin": "https://forge.denizlg24.com"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers=headers,
        method=method,
    )
    try:
        timeout = 300 if path.endswith("/apply-env") else 45
        with opener.open(req, timeout=timeout) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        content_type = error.headers.get("Content-Type", "unknown")
        try:
            payload = json.load(error)
        except (ValueError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict):
            nested = payload.get("error")
            detail = payload.get("message")
            code = payload.get("code")
            if isinstance(nested, dict):
                detail = detail or nested.get("message")
                code = code or nested.get("code")
            elif isinstance(nested, str):
                detail = detail or nested
            safe_code = str(code)[:80] if code else ""
            safe_detail = str(detail)[:180] if detail else error.reason
            message = f"{safe_code}: {safe_detail}" if safe_code else safe_detail
        else:
            server = error.headers.get("Server", "unknown")
            message = f"non-JSON response (Content-Type: {content_type}; Server: {server})"
        raise RuntimeError(f"Forge {method} {path} HTTP {error.code}: {message}") from None


def forge_session(opener):
    token = os.environ.get("FORGE_ACCESS_TOKEN")
    if token:
        return token
    username = input("Forge username: ").strip()
    password = getpass.getpass("Forge password: ")
    result = request(
        opener,
        "/api/auth/sign-in/username",
        "POST",
        {"username": username, "password": password},
    )
    del password
    if result.get("twoFactorRedirect"):
        code = getpass.getpass("Forge TOTP or backup code: ").strip()
        path = (
            "/api/auth/two-factor/verify-totp"
            if code.isdigit() and len(code) == 6
            else "/api/auth/two-factor/verify-backup-code"
        )
        request(opener, path, "POST", {"code": code})
    return None


def forge_vars(opener, token, values):
    path = f"/api/deploy/targets/{TARGET}/env"
    existing = request(opener, path, token=token).get("data")
    if not isinstance(existing, list):
        raise RuntimeError("Forge returned an invalid environment list")
    merged = []
    for row in existing:
        if row.get("key") in FORGE_KEYS:
            # Replace old APNs values and scopes with the intended target-wide values.
            continue
        item = {
            "key": row["key"],
            "source": row["source"],
            "scope": row["scope"],
            "environmentId": row.get("environmentId"),
        }
        if row["source"] == "binding":
            item["reference"] = row["reference"]
        elif row["source"] == "template":
            item["template"] = row["template"]
        elif row["source"] != "literal" or not row.get("hasValue"):
            raise RuntimeError(f"Cannot safely preserve Forge key {row['key']}")
        merged.append(item)
    merged.extend(
        {"key": key, "source": "literal", "scope": "all", "value": values[key]}
        for key in FORGE_KEYS
    )
    updated = request(opener, path, "PUT", {"vars": merged}, token)
    actual = updated.get("data")
    if not isinstance(actual, list) or not all(
        any(row.get("key") == key and row.get("hasValue") for row in actual)
        for key in FORGE_KEYS
    ):
        raise RuntimeError("Forge did not confirm all four APNs values")
    print("Forge: four APNs values saved; applying environment...")
    result = request(opener, f"/api/deploy/targets/{TARGET}/apply-env", "POST", {}, token)
    data = result.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("results"), list):
        raise RuntimeError("Forge returned an invalid environment apply result")
    outcomes = data["results"]
    failed = [row for row in outcomes if not row.get("healthy")]
    if failed:
        raise RuntimeError("Forge environment apply reported an unhealthy deployment")
    print(f"Forge: environment applied to {len(outcomes)} live deployment(s).")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("env_file", type=Path, help="path to your local .env.ios")
    parser.add_argument("--github-only", action="store_true")
    parser.add_argument("--forge-only", action="store_true")
    args = parser.parse_args()
    if args.github_only and args.forge_only:
        parser.error("choose at most one of --github-only and --forge-only")
    values = read_env(args.env_file)
    github = not args.forge_only
    forge = not args.github_only
    if github:
        status = subprocess.run(["gh", "auth", "status"], capture_output=True, text=True)
        if status.returncode:
            raise RuntimeError("GitHub CLI is not authenticated. Run: gh auth login")
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar())
    )
    token = None
    if forge:
        token = forge_session(opener)
        me = request(opener, "/api/me", token=token).get("data", {})
        if me.get("role") != "superuser":
            raise RuntimeError("Forge account must be an active superuser")
        print("Forge authentication verified.")
    if github:
        for key in GITHUB_KEYS:
            subprocess.run(
                ["gh", "secret", "set", key, "--repo", "denizlg24/denizlg24.com", "--env", "macros-release"],
                input=values[key],
                text=True,
                check=True,
            )
            print(f"GitHub: set {key}.")
    if forge:
        forge_vars(opener, token, values)
    print("Store account environment setup complete.")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Setup stopped: {error}", file=sys.stderr)
        sys.exit(1)
