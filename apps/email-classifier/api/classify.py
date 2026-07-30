"""Vercel entry point for POST /api/classify."""

from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path


def _add_source_root() -> None:
    """Make the src-layout package importable when Vercel loads this file."""
    source_root = str(Path(__file__).resolve().parents[1] / "src")
    if source_root not in sys.path:
        sys.path.insert(0, source_root)


_add_source_root()
handler = import_module("email_classifier.http_api").handler

__all__ = ["handler"]
