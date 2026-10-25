"""Artifact verification, local scratch writes, and cached remote model lookup."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


_active_model: tuple[Path, str] | None = None
_active_checked_at = float("-inf")


def active_model() -> tuple[Path, str] | None:
    """Poll durable state every 30 seconds; retain the cache on storage outages."""
    global _active_model, _active_checked_at
    from email_classifier.storage import get_store, remote_enabled

    if not remote_enabled():
        return None
    now = time.monotonic()
    if now - _active_checked_at < 30:
        return _active_model
    try:
        _active_model = get_store().promoted_model()
        _active_checked_at = now
    except Exception as exc:
        # Warm processes retain their verified model. Cold processes can still
        # load the configured bootstrap artifact and retry remote state shortly.
        logging.getLogger(__name__).warning(
            "Remote model refresh failed (%s)", type(exc).__name__
        )
        _active_checked_at = now - 25
    return _active_model


def verify_artifact(path: Path, digest: str) -> None:
    if path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("candidate exceeds the 100 MB runtime limit")
    with path.open("rb") as handle:
        actual = hashlib.file_digest(handle, "sha256").hexdigest()
    if actual != digest:
        raise ValueError("promoted model SHA-256 mismatch")
