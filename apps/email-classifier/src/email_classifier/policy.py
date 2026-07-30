"""Deterministic safety policy applied after statistical prediction."""

from __future__ import annotations

import re
import unicodedata
from pathlib import Path

PROTECTED_SENDER_NAMES = frozenset(
    {
        "alexandra lopes gunes",
        "serafettin gunes",
        "serefettin gunes",
    }
)
SPACE = re.compile(r"\s+")
NON_WORD = re.compile(r"[^\w]+", re.UNICODE)
DEPLOYMENT = re.compile(r"\bdeploy(?:ed|ing|ment|ments)?\b", re.IGNORECASE)
CHANGES_REQUESTED = re.compile(
    r"\b(?:changes?\s+(?:were\s+|are\s+)?requested|requested\s+changes?)\b",
    re.IGNORECASE,
)


def normalize_sender(address: str) -> str:
    """Normalize an exact sender address for policy matching."""
    return address.strip().casefold()


def normalize_sender_name(name: str) -> str:
    """Normalize a display name while preserving word boundaries."""
    decomposed = unicodedata.normalize("NFKD", name).casefold()
    without_marks = "".join(
        character
        for character in decomposed
        if not unicodedata.combining(character)
    )
    return SPACE.sub(" ", NON_WORD.sub(" ", without_marks)).strip()


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


def is_protected_sender(
    sender_name: str,
    sender_address: str,
    protected_senders: frozenset[str],
) -> bool:
    """Return whether an email belongs to a private or built-in protected contact."""
    normalized_name = normalize_sender_name(sender_name)
    return (
        normalize_sender(sender_address) in protected_senders
        or any(
            protected_name in normalized_name
            for protected_name in PROTECTED_SENDER_NAMES
        )
    )


def vercel_deployment_category(raw_email: dict[str, object]) -> str | None:
    """Apply Deniz's rule for routine Vercel deployment notifications."""
    sender = " ".join(
        (
            str(raw_email.get("sender_name") or raw_email.get("senderName") or ""),
            str(
                raw_email.get("sender_address")
                or raw_email.get("senderAddress")
                or raw_email.get("fromAddress")
                or ""
            ),
        )
    )
    subject = str(raw_email.get("subject") or "")
    body = str(
        raw_email.get("body")
        or raw_email.get("bodyText")
        or raw_email.get("snippet")
        or ""
    )
    header = f"{sender}\n{subject}"
    if "vercel" not in header.casefold():
        return None
    if not DEPLOYMENT.search(subject) and not (
        "vercel" in sender.casefold() and DEPLOYMENT.search(body[:4000])
    ):
        return None
    return (
        "action-needed"
        if CHANGES_REQUESTED.search(f"{subject}\n{body}")
        else "fyi"
    )


def apply_policy(
    predicted_label: str,
    sender_address: str,
    protected_senders: frozenset[str],
    sender_name: str = "",
) -> tuple[str, str | None]:
    """Prevent protected contacts from receiving an automatic spam outcome."""
    if predicted_label == "spam" and is_protected_sender(
        sender_name, sender_address, protected_senders
    ):
        return "needs-review", "protected-sender-spam"
    return predicted_label, None
