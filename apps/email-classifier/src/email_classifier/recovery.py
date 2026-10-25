"""Recover missing seed data from human-reviewed mail without weakening evaluation."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import uuid
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from email_classifier.artifacts import write_json
from email_classifier.data import (
    LABELS,
    Dataset,
    DatasetBundle,
    DatasetError,
    _content_hash,
    load_datasets,
)
from email_classifier.partial import adaptation_plan


def _components(rows: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Keep threads and identical content together, even across mail accounts."""
    parents: dict[str, str] = {}

    def find(key: str) -> str:
        parents.setdefault(key, key)
        root = key
        while parents[root] != root:
            root = parents[root]
        while parents[key] != key:
            parent = parents[key]
            parents[key] = root
            key = parent
        return root

    hashes: dict[str, str] = {}
    for row in rows:
        group = find(row["group_id"])
        digest = _content_hash(row)
        if digest in hashes:
            other = find(hashes[digest])
            parents[max(group, other)] = min(group, other)
        hashes[digest] = row["group_id"]
    groups: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault(find(row["group_id"]), []).append(row)
    return [groups[key] for key in sorted(groups)]


def _received_after(row: dict[str, Any], cutoff: str) -> bool:
    # Both ingestion time and message time must be recent. An old email newly
    # synced from IMAP is not proof of being unseen by the incumbent model.
    return all(
        isinstance(row.get(key), str) and row[key] > cutoff
        for key in ("received_at", "ingested_at")
    )


def recover_seed(
    root: Path, rows: list[dict[str, Any]], report: dict[str, Any]
) -> DatasetBundle | None:
    recovery_path = root / "recovery.json"
    if not recovery_path.exists():
        write_json(recovery_path, {"started_at": datetime.now(UTC).isoformat()})
    cutoff = json.loads(recovery_path.read_text())["started_at"]
    training, evaluation = [], []
    labels: dict[str, str] = {}
    for group in _components(rows):
        # A deterministic 20% of entirely new groups are reserved for validation.
        # Historical examples can train, but cannot establish unseen performance.
        group_id = min(row["group_id"] for row in group)
        reserved = int(hashlib.sha256(group_id.encode()).hexdigest(), 16) % 5 == 0
        is_eval = reserved and all(_received_after(row, cutoff) for row in group)
        # Historical members of a reserved group keep that whole group in train.
        # Before freezing the seed, no candidate is trained or promoted.
        target = evaluation if is_eval else training
        seen: set[str] = set()
        for original in sorted(group, key=lambda row: row["id"]):
            digest = _content_hash(original)
            if digest in labels and labels[digest] != original["label"]:
                raise DatasetError("conflicting human labels for duplicate content")
            labels[digest] = original["label"]
            if digest in seen:
                continue
            seen.add(digest)
            target.append(
                {
                    **original,
                    "group_id": group_id,
                    "split": "eval" if is_eval else "train",
                }
            )
    train_counts = Counter(row["label"] for row in training)
    eval_counts = Counter(row["label"] for row in evaluation)
    report["recovery"] = {
        "validation_after": cutoff,
        "training_per_category": {label: train_counts[label] for label in LABELS},
        "validation_per_category": {label: eval_counts[label] for label in LABELS},
        "required_training_per_category": 5,
        "required_validation_per_category": 5,
    }
    train_dataset = Dataset(root / "seed/train.jsonl", tuple(training))
    eval_dataset = Dataset(root / "seed/eval.jsonl", tuple(evaluation))
    adapted, reason = adaptation_plan(train_dataset, eval_dataset)
    report["recovery"].update(
        adaptable_categories=list(adapted),
        frozen_categories=[label for label in LABELS if label not in adapted],
        required_adaptable_categories=2,
    )
    if reason:
        report["reason"] = "recovering missing seed data: " + reason
        return None
    # Publish the complete set as one directory. Partial writes from a crash
    # never become the seed used by a later run.
    stage = root / f".seed-{uuid.uuid4().hex}"
    stage.mkdir(mode=0o700)
    try:
        for name, split in (("train", training), ("eval", evaluation)):
            path = stage / f"{name}.jsonl"
            with path.open("w") as handle:
                for row in split:
                    handle.write(json.dumps(row, sort_keys=True) + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        write_json(
            stage / "manifest.json",
            {
                "schemaVersion": 2,
                "source": "human-reviewed-mongodb-recovery",
                "validation_after": cutoff,
                "rows": {"train": len(training), "eval": len(evaluation)},
                "created_at": datetime.now(UTC).isoformat(),
            },
        )
        load_datasets(
            stage / "train.jsonl",
            stage / "eval.jsonl",
            stage / "manifest.json",
            require_all_labels=False,
        )
        stage.replace(root / "seed")
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    report["seed_recovered"] = True
    return load_datasets(
        root / "seed/train.jsonl",
        root / "seed/eval.jsonl",
        root / "seed/manifest.json",
        require_all_labels=False,
    )


def seed_dataset(
    root: Path, rows: list[dict[str, Any]], report: dict[str, Any]
) -> DatasetBundle | None:
    defaults = [
        root / "seed" / name for name in ("train.jsonl", "eval.jsonl", "manifest.json")
    ]
    paths = [
        Path(os.getenv(name) or default).resolve()
        for name, default in zip(
            (
                "EMAIL_CLASSIFIER_TRAIN_PATH",
                "EMAIL_CLASSIFIER_EVAL_PATH",
                "EMAIL_CLASSIFIER_MANIFEST_PATH",
            ),
            defaults,
            strict=True,
        )
    ]
    if all(path.exists() for path in paths):
        return load_datasets(*paths, require_all_labels=False)
    if any(path.exists() for path in paths):
        raise DatasetError("partial seed dataset: restore or remove it before recovery")
    if paths != [path.resolve() for path in defaults]:
        raise DatasetError(
            "custom seed files are missing; unset path overrides to recover"
        )
    return recover_seed(root, rows, report)
