"""Serialized retraining worker, started by cron through the authenticated API."""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

import joblib

from email_classifier.artifacts import verify_artifact, write_json
from email_classifier.data import (
    LABELS,
    Dataset,
    _content_hash,
    _validate_bundle,
    prepare_inference_row,
)
from email_classifier.evaluate import classification_metrics
from email_classifier.partial import (
    PartialCategoryClassifier,
    adaptation_plan,
    supported_training,
)
from email_classifier.paths import APP_ROOT
from email_classifier.recovery import seed_dataset
from email_classifier.runtime import RuntimeClassifier, load_runtime_classifier
from email_classifier.storage import LeaseLost, RemoteStore, get_store, remote_enabled
from email_classifier.train import train_candidate

logger = logging.getLogger(__name__)
_children: list[subprocess.Popen] = []


def start_retraining() -> dict[str, Any]:
    """Acquire a durable lease before spawning a disposable training worker."""
    if not remote_enabled():
        raise RuntimeError("EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX is required")
    if not os.environ.get("RESEND_API_KEY"):
        raise RuntimeError("RESEND_API_KEY is required")
    store = get_store()
    _children[:] = [child for child in _children if child.poll() is None]
    run_id = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    acquired, owner = store.acquire(run_id)
    if not acquired:
        return {"status": "already-running", "run_id": owner}
    env = {
        **os.environ,
        "OMP_NUM_THREADS": "1",
        "OPENBLAS_NUM_THREADS": "1",
        "PYTHONPATH": os.pathsep.join(
            (str(APP_ROOT / "src"), os.environ.get("PYTHONPATH", ""))
        ),
    }
    try:
        child = subprocess.Popen(
            [sys.executable, "-m", "email_classifier.retrain", "--run-id", run_id],
            env=env,
            start_new_session=True,
            # Only safe training progress is logged; never dump an exception.
            stdout=None,
            stderr=None,
        )
    except Exception as exc:
        store.finish(
            run_id,
            {"run_id": run_id, "status": "failed", "error_type": type(exc).__name__},
        )
        raise
    _children.append(child)
    return {"status": "accepted", "run_id": run_id}


def notify(run_id: str, status: str, details: dict[str, Any]) -> None:
    """Reuse the web application's Resend key; never send email contents."""
    key = os.environ["RESEND_API_KEY"]
    payload = {
        "from": "Email Classifier <denizgunes@oceaninformatix.com>",
        "to": ["denizlg24@gmail.com"],
        "subject": f"Email classifier retraining: {status}",
        "text": f"Run: {run_id}\nStatus: {status}\n\n"
        + json.dumps(details, indent=2, sort_keys=True),
    }
    request = Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": "email-classifier-retraining/1",
            "Idempotency-Key": f"email-retraining/{run_id}/{status}",
        },
        method="POST",
    )
    for attempt in range(3):
        try:
            with urlopen(request, timeout=20) as response:
                json.load(response)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2**attempt)


def correction_rows(db: Any) -> tuple[list[dict[str, Any]], int]:
    """Only human overrides or explicitly reviewed labels are training evidence."""
    pipeline = [
        {
            "$match": {
                "category": {"$in": list(LABELS)},
                "$or": [
                    {"llmCategory": {"$in": list(LABELS)}},
                    {"userStatus": "reviewed", "reviewRequired": False},
                ],
            }
        },
        {
            "$lookup": {
                "from": "emails",
                "localField": "emailId",
                "foreignField": "_id",
                "as": "email",
            }
        },
        {"$unwind": "$email"},
        {
            "$lookup": {
                "from": "emailbodies",
                "localField": "emailId",
                "foreignField": "emailId",
                "as": "body",
            }
        },
        {"$unwind": "$body"},
        {
            "$project": {
                "emailId": 1,
                "accountId": 1,
                "category": 1,
                "email.subject": 1,
                "email.from": 1,
                "email.threadId": 1,
                "email.messageId": 1,
                "email.date": 1,
                "email.createdAt": 1,
                "body.text": 1,
                "body.html": 1,
                "body.attachmentCount": 1,
                "body.truncated": 1,
            }
        },
        {"$sort": {"emailId": 1}},
    ]
    rows = []
    skipped = 0
    for doc in db.emailtriages.aggregate(pipeline, allowDiskUse=True):
        # HTML-only bodies need the same normalization as production. Until
        # that is available here, skip them rather than train on raw markup.
        body, email = doc["body"], doc["email"]
        if body.get("truncated") or not body.get("text", "").strip():
            skipped += 1
            continue
        sender = (email.get("from") or [{}])[0]
        thread = email.get("threadId") or email.get("messageId") or doc["emailId"]
        row = prepare_inference_row(
            {
                "id": str(doc["emailId"]),
                "label": doc["category"],
                "subject": email.get("subject", ""),
                "body": body["text"],
                "sender_name": sender.get("name") or "",
                "sender_address": sender.get("address") or "",
                "attachment_count": body.get("attachmentCount", 0),
                "has_html": bool(body.get("html")),
                "source": "local",
                "sample_weight": 1.0,
                "group_id": f"{doc['accountId']}:{thread}",
            }
        )
        for source, field in (("date", "received_at"), ("createdAt", "ingested_at")):
            value = email.get(source)
            row[field] = (
                value.replace(tzinfo=value.tzinfo or UTC).astimezone(UTC).isoformat()
                if isinstance(value, datetime)
                else ""
            )
        rows.append(row)
    return rows, skipped


def merge_corrections(
    base: Dataset, evaluation: Dataset, corrections: list[dict[str, Any]]
) -> tuple[Dataset, int]:
    """Keep the frozen holdout separate, including thread and content duplicates."""
    eval_ids = {r["id"] for r in evaluation.rows}
    eval_hashes = {_content_hash(r) for r in evaluation.rows}
    eval_groups = {r["group_id"] for r in evaluation.rows}
    # Match legacy groups by a known email ID/content before assigning new groups.
    known_groups = {r["id"]: r["group_id"] for r in (*base.rows, *evaluation.rows)}
    known_hash_groups = {
        _content_hash(r): r["group_id"] for r in (*base.rows, *evaluation.rows)
    }
    aliases = {}
    for row in corrections:
        known = known_groups.get(row["id"], known_hash_groups.get(_content_hash(row)))
        if known is not None:
            # Carry a known legacy group onto every newly exported sibling in
            # that thread, including siblings of a held-out message.
            existing = aliases.get(row["group_id"])
            if existing is not None and existing != known:
                raise ValueError("seed group identifiers disagree within a thread")
            aliases[row["group_id"]] = known
    accepted = []
    for original in corrections:
        row = dict(original)
        row["group_id"] = aliases.get(row["group_id"], row["group_id"])
        if (
            row["id"] in eval_ids
            or _content_hash(row) in eval_hashes
            or row["group_id"] in eval_groups
        ):
            continue
        row["split"] = "train"
        accepted.append(row)
    ids = {r["id"] for r in accepted}
    hashes = {_content_hash(r) for r in accepted}
    rows = [
        dict(r)
        for r in base.rows
        if r["id"] not in ids and _content_hash(r) not in hashes
    ]
    # An identical message can occur in multiple accounts. Conflicting human
    # labels are ambiguous evidence, so fail instead of silently choosing one.
    unique: dict[str, dict[str, Any]] = {}
    for row in accepted:
        digest = _content_hash(row)
        if digest in unique and unique[digest]["label"] != row["label"]:
            raise ValueError("conflicting human labels for duplicate content")
        unique[digest] = row
    merged = Dataset(base.path, tuple(rows + list(unique.values())))
    _validate_bundle(merged, evaluation)
    return merged, len(accepted)


def promotion_reasons(
    incumbent: dict[str, Any],
    candidate: dict[str, Any],
    *,
    supported: tuple[str, ...] | None = None,
) -> list[str]:
    reasons = []
    if supported is None:
        old_score, new_score = incumbent["macro_f1"], candidate["macro_f1"]
    else:
        old_score = sum(
            incumbent["per_class"][label]["f1-score"] for label in supported
        ) / len(supported)
        new_score = sum(
            candidate["per_class"][label]["f1-score"] for label in supported
        ) / len(supported)
    if new_score < old_score + 0.005:
        reasons.append("supported-category macro-F1 must improve by at least 0.005")
    for label in LABELS:
        old, new = incumbent["per_class"][label], candidate["per_class"][label]
        if new["f1-score"] < old["f1-score"] - 0.02:
            reasons.append(f"{label} F1 regressed by more than 0.02")
        if label in {"action-needed", "scheduled"} and new["recall"] < old["recall"]:
            reasons.append(f"{label} recall regressed")
    if (
        candidate["spam_counts"]["false_positive"]
        > incumbent["spam_counts"]["false_positive"]
    ):
        reasons.append("spam false positives increased")
    return reasons


def score(classifier: RuntimeClassifier, dataset: Dataset) -> dict[str, Any]:
    # Evaluate the deployed policy as well as the estimator.
    return classification_metrics(
        dataset.labels, [classifier.predict(row).category for row in dataset.rows]
    )


def execute(root: Path, run_id: str, report: dict[str, Any], store: RemoteStore) -> str:
    store.prepare(root, run_id)
    corrections, skipped = correction_rows(store.db)
    report.update(reviewed_examples=len(corrections), skipped_bodies=skipped)
    bundle = seed_dataset(root, corrections, report)
    store.persist_seed(root, run_id)
    if bundle is None:
        return "skipped"
    training, count = merge_corrections(bundle.train, bundle.eval, corrections)
    report.update(
        human_examples=count,
        skipped_bodies=skipped,
        training_rows=len(training.rows),
        evaluation_rows=len(bundle.eval.rows),
    )
    adapted, reason = adaptation_plan(training, bundle.eval)
    report.update(
        adapted_categories=list(adapted),
        frozen_categories=[label for label in LABELS if label not in adapted],
    )
    if reason:
        report["reason"] = reason
        return "skipped"
    training = supported_training(training, adapted)
    report["training_rows"] = len(training.rows)
    implementation = hashlib.sha256()
    for source in sorted(Path(__file__).parent.glob("*.py")):
        implementation.update(source.name.encode())
        implementation.update(source.read_bytes())
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "train": training.rows,
                "eval": bundle.eval.rows,
                "code": implementation.hexdigest(),
            },
            sort_keys=True,
        ).encode()
    ).hexdigest()
    report["dataset_sha256"] = fingerprint
    if store.read().get("last_attempt", {}).get("dataset_sha256") == fingerprint:
        report["reason"] = "training data unchanged since the last completed attempt"
        return "skipped"
    if count < 10:
        report["reason"] = "need at least 10 eligible human examples"
        return "skipped"
    incumbent = load_runtime_classifier()
    candidate = train_candidate(training, "logistic-regression")
    model = (
        candidate.pipeline
        if set(adapted) == set(LABELS)
        else PartialCategoryClassifier(incumbent.model, candidate.pipeline)
    )
    runtime = RuntimeClassifier(
        model,
        tuple(str(c) for c in model.named_steps["classifier"].classes_),
        run_id,
    )
    old_metrics, new_metrics = (
        score(incumbent, bundle.eval),
        score(runtime, bundle.eval),
    )
    reasons = promotion_reasons(old_metrics, new_metrics, supported=adapted)
    report.update(
        incumbent_version=incumbent.model_version,
        incumbent_metrics=old_metrics,
        candidate_metrics=new_metrics,
        rejection_reasons=reasons,
        training_seconds=candidate.training_seconds,
        selection_metric="supported_category_macro_f1",
        incumbent_supported_macro_f1=sum(
            old_metrics["per_class"][label]["f1-score"] for label in adapted
        )
        / len(adapted),
        candidate_supported_macro_f1=sum(
            new_metrics["per_class"][label]["f1-score"] for label in adapted
        )
        / len(adapted),
    )
    # Keep an exact immutable training snapshot and report for each evaluated run.
    snapshot = root / "training.jsonl"
    with snapshot.open("w") as handle:
        for row in training.rows:
            handle.write(json.dumps(row, sort_keys=True) + "\n")
    report["training_artifact"] = store.upload(
        snapshot, f"runs/{run_id}/train.jsonl", limit=256 * 1024 * 1024
    )
    write_json(root / "metrics.json", report)
    store.upload(
        root / "metrics.json", f"runs/{run_id}/metrics.json", limit=4 * 1024 * 1024
    )
    if not reasons:
        path = root / "model.joblib"
        joblib.dump(model, path)
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        verify_artifact(path, digest)
        loaded = joblib.load(path)
        RuntimeClassifier(loaded, runtime.classes, run_id).predict(
            bundle.eval.inputs[0]
        )
        pointer = store.upload(path, f"models/{run_id}.joblib", limit=100 * 1024 * 1024)
        pointer.update(run_id=run_id, promoted_at=datetime.now(UTC).isoformat())
        # The Mongo update is fenced by the lease, after upload verification.
        store.promote(run_id, pointer)
        report["model_version"] = f"sha256:{digest[:12]}"
    store.update(
        run_id, {"last_attempt": {"dataset_sha256": fingerprint, "run_id": run_id}}
    )
    return "rejected" if reasons else "promoted"


def run_worker(run_id: str) -> int:
    store = get_store()
    report: dict[str, Any] = {
        "run_id": run_id,
        "started_at": datetime.now(UTC).isoformat(),
    }
    started = time.monotonic()

    def timeout(_signum: int, _frame: Any) -> None:
        raise TimeoutError("retraining exceeded two hours")

    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(7200)
    status = "failed"
    try:
        store.update(run_id, {"run": {**report, "status": "started"}})
        notify(run_id, "started", report)
        with tempfile.TemporaryDirectory(
            prefix="email-classifier-training-"
        ) as directory:
            status = execute(Path(directory), run_id, report, store)
    except Exception as exc:
        report["error_type"] = type(exc).__name__
        logger.error("Retraining failed (%s)", type(exc).__name__)
    finally:
        signal.alarm(0)
        report.update(
            status=status,
            finished_at=datetime.now(UTC).isoformat(),
            duration_seconds=round(time.monotonic() - started, 2),
        )
        try:
            # Do not send misleading completion for a run superseded after expiry.
            store.update(run_id, {"run": {**report, "status": "started"}})
            try:
                notify(run_id, status, report)
            except Exception as exc:
                report["notification_error"] = type(exc).__name__
                logger.error("Resend notification failed (%s)", type(exc).__name__)
            store.finish(run_id, report)
        except LeaseLost:
            logger.error("Worker lost its lease; no completion state published")
            return 1
    return int(status == "failed" or "notification_error" in report)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-id")
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    if args.rollback:
        print(json.dumps(get_store().rollback()))
        return 0
    if args.run_id:
        return run_worker(args.run_id)
    print(json.dumps(start_retraining()))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        logger.error("Retraining worker failed (%s)", type(exc).__name__)
        raise SystemExit(1) from None
