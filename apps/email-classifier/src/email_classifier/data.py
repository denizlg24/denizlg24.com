"""Dataset loading, normalization, and leakage validation."""

from __future__ import annotations

import hashlib
import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from email_classifier.paths import EVAL_PATH, MANIFEST_PATH, TRAIN_PATH

LABELS = (
    "spam",
    "newsletter",
    "promo",
    "purchases",
    "fyi",
    "action-needed",
    "scheduled",
)
LABEL_SET = frozenset(LABELS)
REQUIRED_FIELDS = (
    "id",
    "label",
    "subject",
    "body",
    "sender_name",
    "sender_address",
    "sender_domain",
    "source",
    "sample_weight",
    "group_id",
)
STRING_FIELDS = (
    "id",
    "subject",
    "body",
    "sender_name",
    "sender_address",
    "sender_domain",
    "source",
    "group_id",
)


class DatasetError(ValueError):
    """Raised when prepared classifier data violates its contract."""


@dataclass(frozen=True, slots=True)
class Dataset:
    """One validated dataset split."""

    path: Path
    rows: tuple[dict[str, Any], ...]

    @property
    def texts(self) -> list[str]:
        return [str(row["text"]) for row in self.rows]

    @property
    def inputs(self) -> list[dict[str, Any]]:
        return [dict(row) for row in self.rows]

    @property
    def labels(self) -> list[str]:
        return [str(row["label"]) for row in self.rows]

    @property
    def groups(self) -> list[str]:
        return [str(row["group_id"]) for row in self.rows]

    @property
    def sample_weights(self) -> list[float]:
        return [float(row["sample_weight"]) for row in self.rows]

    @property
    def distribution(self) -> dict[str, int]:
        counts = Counter(self.labels)
        return {label: counts[label] for label in LABELS}


@dataclass(frozen=True, slots=True)
class DatasetBundle:
    """Validated training and final-evaluation datasets plus their manifest."""

    train: Dataset
    eval: Dataset
    manifest: dict[str, Any]
    manifest_path: Path


def canonical_text(row: dict[str, Any]) -> str:
    """Return the stable text representation used by training and inference."""
    subject = str(row.get("subject") or "").strip() or "(no subject)"
    sender_name = str(row.get("sender_name") or row.get("senderName") or "").strip()
    sender_address = str(
        row.get("sender_address")
        or row.get("senderAddress")
        or row.get("fromAddress")
        or ""
    ).strip()
    if sender_name and sender_address:
        sender = f"{sender_name} <{sender_address}>"
    else:
        sender = sender_address or sender_name or "(unknown sender)"
    body = str(row.get("body") or row.get("bodyText") or row.get("snippet") or "")
    return f"[SUBJECT]\n{subject}\n[FROM]\n{sender}\n[BODY]\n{body or '(empty body)'}"


def prepare_inference_row(raw: dict[str, Any]) -> dict[str, Any]:
    """Normalize common API field aliases into the model input contract."""
    sender_address = str(
        raw.get("sender_address")
        or raw.get("senderAddress")
        or raw.get("fromAddress")
        or ""
    ).strip()
    sender_domain = str(
        raw.get("sender_domain")
        or raw.get("senderDomain")
        or raw.get("fromDomain")
        or ""
    ).strip()
    if not sender_domain and "@" in sender_address:
        sender_domain = sender_address.rsplit("@", 1)[1]
    row = {
        **raw,
        "subject": str(raw.get("subject") or ""),
        "body": str(
            raw.get("body") or raw.get("bodyText") or raw.get("snippet") or ""
        ),
        "sender_name": str(
            raw.get("sender_name")
            or raw.get("senderName")
            or raw.get("fromName")
            or ""
        ),
        "sender_address": sender_address.casefold(),
        "sender_domain": sender_domain.casefold(),
        "attachment_count": max(
            int(raw.get("attachment_count") or raw.get("attachmentCount") or 0),
            0,
        ),
        "has_html": bool(raw.get("has_html") or raw.get("hasHtml")),
    }
    row["text"] = str(raw.get("text") or canonical_text(row))
    return row


def file_sha256(path: Path) -> str:
    """Hash a file without loading it all into memory."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _content_hash(row: dict[str, Any]) -> str:
    explicit = row.get("content_hash")
    if isinstance(explicit, str) and explicit:
        return explicit
    return hashlib.sha256(str(row["text"]).encode("utf-8")).hexdigest()


def _validate_row(
    raw: Any,
    *,
    path: Path,
    line_number: int,
    expected_split: str,
) -> dict[str, Any]:
    location = f"{path}:{line_number}"
    if not isinstance(raw, dict):
        raise DatasetError(f"{location}: expected a JSON object")
    missing = [field for field in REQUIRED_FIELDS if field not in raw]
    if missing:
        raise DatasetError(f"{location}: missing fields: {', '.join(missing)}")
    if raw["label"] not in LABEL_SET:
        raise DatasetError(f"{location}: unknown label {raw['label']!r}")
    for field in STRING_FIELDS:
        if not isinstance(raw[field], str):
            raise DatasetError(f"{location}: {field} must be a string")
    if not raw["id"]:
        raise DatasetError(f"{location}: id must not be empty")
    if not raw["group_id"]:
        raise DatasetError(f"{location}: group_id must not be empty")
    try:
        weight = float(raw["sample_weight"])
    except (TypeError, ValueError) as exc:
        raise DatasetError(f"{location}: sample_weight must be numeric") from exc
    if not math.isfinite(weight) or weight <= 0:
        raise DatasetError(
            f"{location}: sample_weight must be positive and finite"
        )
    split = raw.get("split")
    if split is not None and split != expected_split:
        raise DatasetError(
            f"{location}: split is {split!r}, expected {expected_split!r}"
        )
    row = dict(raw)
    row["sample_weight"] = weight
    row["attachment_count"] = max(int(raw.get("attachment_count") or 0), 0)
    row["has_html"] = bool(raw.get("has_html"))
    row["text"] = str(raw.get("text") or canonical_text(row))
    return row


def load_jsonl(path: Path, *, split: str) -> Dataset:
    """Load and validate one non-empty JSONL split."""
    rows: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    try:
        handle = path.open("r", encoding="utf-8")
    except OSError as exc:
        raise DatasetError(f"cannot open {path}: {exc}") from exc
    with handle:
        for line_number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError as exc:
                raise DatasetError(
                    f"{path}:{line_number}: invalid JSON: {exc}"
                ) from exc
            row = _validate_row(
                raw,
                path=path,
                line_number=line_number,
                expected_split=split,
            )
            row_id = str(row["id"])
            if row_id in seen_ids:
                raise DatasetError(f"{path}:{line_number}: duplicate id {row_id!r}")
            seen_ids.add(row_id)
            rows.append(row)
    if not rows:
        raise DatasetError(f"{path}: no rows found")
    missing_labels = sorted(LABEL_SET - {str(row["label"]) for row in rows})
    if missing_labels:
        raise DatasetError(f"{path}: missing labels: {', '.join(missing_labels)}")
    return Dataset(path=path.resolve(), rows=tuple(rows))


def _load_manifest(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except OSError as exc:
        raise DatasetError(f"cannot open {path}: {exc}") from exc
    except json.JSONDecodeError as exc:
        raise DatasetError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise DatasetError(f"{path}: expected a JSON object")
    if value.get("schemaVersion") not in {1, 2}:
        raise DatasetError(f"{path}: unsupported schemaVersion")
    return value


def _validate_bundle(train: Dataset, evaluation: Dataset) -> None:
    train_ids = {str(row["id"]) for row in train.rows}
    eval_ids = {str(row["id"]) for row in evaluation.rows}
    overlap = train_ids & eval_ids
    if overlap:
        raise DatasetError(f"train/eval id overlap: {sorted(overlap)[:3]}")

    train_hashes = {_content_hash(row) for row in train.rows}
    eval_hashes = {_content_hash(row) for row in evaluation.rows}
    hash_overlap = train_hashes & eval_hashes
    if hash_overlap:
        raise DatasetError(
            f"train/eval exact-content overlap: {len(hash_overlap)} row(s)"
        )

    train_local_groups = {
        str(row["group_id"]) for row in train.rows if row["source"] == "local"
    }
    eval_local_groups = {
        str(row["group_id"]) for row in evaluation.rows if row["source"] == "local"
    }
    group_overlap = train_local_groups & eval_local_groups
    if group_overlap:
        raise DatasetError(
            f"train/eval local group overlap: {sorted(group_overlap)[:3]}"
        )
    synthetic_eval = [
        str(row["id"]) for row in evaluation.rows if row["source"] == "synthetic"
    ]
    if synthetic_eval:
        raise DatasetError(
            f"evaluation contains synthetic rows: {synthetic_eval[:3]}"
        )


def load_datasets(
    train_path: Path = TRAIN_PATH,
    eval_path: Path = EVAL_PATH,
    manifest_path: Path = MANIFEST_PATH,
) -> DatasetBundle:
    """Load the prepared dataset and enforce split/manifest invariants."""
    train = load_jsonl(train_path, split="train")
    evaluation = load_jsonl(eval_path, split="eval")
    manifest = _load_manifest(manifest_path)
    _validate_bundle(train, evaluation)
    manifest_rows = manifest.get("rows")
    if isinstance(manifest_rows, dict):
        expected_train = manifest_rows.get("train")
        expected_eval = manifest_rows.get("eval")
        if expected_train is not None and expected_train != len(train.rows):
            raise DatasetError(
                f"manifest train count {expected_train} != {len(train.rows)}"
            )
        if expected_eval is not None and expected_eval != len(evaluation.rows):
            raise DatasetError(
                f"manifest eval count {expected_eval} != {len(evaluation.rows)}"
            )
    return DatasetBundle(
        train=train,
        eval=evaluation,
        manifest=manifest,
        manifest_path=manifest_path.resolve(),
    )
