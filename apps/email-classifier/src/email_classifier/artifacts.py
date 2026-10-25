"""Atomic pointers to locally promoted models on a persistent service volume."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any


def retraining_root() -> Path:
    value = os.environ.get("EMAIL_CLASSIFIER_RETRAIN_DIR", "").strip()
    if not value:
        raise RuntimeError("EMAIL_CLASSIFIER_RETRAIN_DIR must name a persistent volume")
    return Path(value).resolve()


def write_json(path: Path, value: Any) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w") as handle:
        json.dump(value, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    temporary.replace(path)


def active_model() -> tuple[Path, str] | None:
    if not os.environ.get("EMAIL_CLASSIFIER_RETRAIN_DIR", "").strip():
        return None
    root = retraining_root()
    pointer = root / "active.json"
    if not pointer.exists():
        return None
    manifest = json.loads(pointer.read_text())
    path = (root / manifest["artifact"]).resolve()
    if not path.is_relative_to(root):
        raise ValueError("active model must be inside the retraining volume")
    digest = manifest["sha256"]
    if len(digest) != 64 or any(c not in "0123456789abcdef" for c in digest):
        raise ValueError("invalid active model digest")
    return path, digest


def verify_artifact(path: Path, digest: str) -> None:
    if path.stat().st_size > 100 * 1024 * 1024:
        raise ValueError("candidate exceeds the 100 MB runtime limit")
    with path.open("rb") as handle:
        actual = hashlib.file_digest(handle, "sha256").hexdigest()
    if actual != digest:
        raise ValueError("promoted model SHA-256 mismatch")
