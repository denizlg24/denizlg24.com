"""Deterministic safety policy applied after statistical prediction."""

from __future__ import annotations

from pathlib import Path


def normalize_sender(address: str) -> str:
    """Normalize an exact sender address for policy matching."""
    return address.strip().casefold()


def load_protected_senders(path: Path) -> frozenset[str]:
    """Load newline-separated addresses; missing local config means none."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return frozenset()
    return frozenset(
        normalized
        for line in lines
        if line.strip() and not line.lstrip().startswith("#")
        if (normalized := normalize_sender(line))
    )


def apply_policy(
    predicted_label: str,
    sender_address: str,
    protected_senders: frozenset[str],
) -> tuple[str, str | None]:
    """Prevent protected contacts from receiving an automatic spam outcome."""
    if (
        predicted_label == "spam"
        and normalize_sender(sender_address) in protected_senders
    ):
        return "needs-review", "protected-sender-spam"
    return predicted_label, None
