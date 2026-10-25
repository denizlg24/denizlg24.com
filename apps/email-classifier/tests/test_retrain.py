from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import joblib
import numpy as np
import pytest
from fastapi.testclient import TestClient

import main
from email_classifier import artifacts, retrain, runtime, storage
from email_classifier.artifacts import write_json
from email_classifier.data import LABELS, Dataset, prepare_inference_row
from email_classifier.evaluate import classification_metrics


class ProbabilityModel:
    def __init__(self, label="fyi"):
        self.named_steps = {"classifier": SimpleNamespace(classes_=np.array(LABELS))}
        self.label = label

    def predict(self, rows):
        return np.array([self.label] * len(rows))

    def predict_proba(self, rows):
        return np.array(
            [[1.0 if label == self.label else 0.0 for label in LABELS] for _ in rows]
        )


class MemoryStore:
    def __init__(self):
        self.state = {}
        self.db = Mock()
        self.objects = {}

    def read(self):
        return copy.deepcopy(self.state)

    def update(self, run_id, fields):
        self.state.update(copy.deepcopy(fields))

    def finish(self, run_id, report):
        self.state["run"] = copy.deepcopy(report)

    def prepare(self, root, run_id):
        pass

    def persist_seed(self, root, run_id):
        pass

    def status(self):
        return self.state.get("run", {"status": "never-run"})

    def upload(self, path, suffix, **kwargs):
        data = path.read_bytes()
        self.objects[suffix] = data
        return {"key": "retrain/" + suffix, "sha256": hashlib.sha256(data).hexdigest()}

    def promote(self, run_id, pointer):
        self.state["previous_model"] = self.state.get("active_model")
        self.state["active_model"] = pointer


def row(identifier, label="fyi", group=None):
    return prepare_inference_row(
        {
            "id": identifier,
            "label": label,
            "subject": identifier,
            "body": f"Body of {identifier}",
            "sender_address": "person@example.com",
            "sender_name": "Person",
            "source": "local",
            "sample_weight": 1.0,
            "group_id": group or identifier,
        }
    )


def datasets(tmp_path):
    train = Dataset(
        tmp_path / "train.jsonl",
        tuple(row(f"train-{i}", label) for i, label in enumerate(LABELS)),
    )
    evaluation = Dataset(
        tmp_path / "eval.jsonl",
        tuple(row(f"eval-{i}", label) for i, label in enumerate(LABELS)),
    )
    return train, evaluation


def test_corrections_replace_labels_and_exclude_holdout_id_content_and_thread(tmp_path):
    train, evaluation = datasets(tmp_path)
    correction = {**train.rows[0], "label": "fyi"}
    # Add a second spam example so the correction doesn't remove that class.
    train = Dataset(train.path, (*train.rows, row("extra-spam", "spam")))
    corrections = [
        correction,
        dict(evaluation.rows[0]),
        {**evaluation.rows[1], "id": "duplicate-eval"},
        row("same-thread", group=evaluation.groups[2]),
    ]
    merged, count = retrain.merge_corrections(train, evaluation, corrections)
    assert count == 1
    assert next(r for r in merged.rows if r["id"] == correction["id"])["label"] == "fyi"
    assert "same-thread" not in {r["id"] for r in merged.rows}


def test_conflicting_duplicate_human_labels_fail(tmp_path):
    train, evaluation = datasets(tmp_path)
    first = row("new")
    second = {**first, "id": "other", "label": "spam"}
    with pytest.raises(ValueError, match="conflicting"):
        retrain.merge_corrections(train, evaluation, [first, second])


def metrics():
    report = classification_metrics(list(LABELS), list(LABELS))
    report["macro_f1"] = 0.8
    return report


def test_promotion_requires_improvement_and_preserves_critical_categories():
    old = metrics()
    new = copy.deepcopy(old)
    assert retrain.promotion_reasons(old, new)
    new["macro_f1"] = 0.81
    assert retrain.promotion_reasons(old, new) == []
    new["per_class"]["action-needed"]["recall"] = 0.9
    new["per_class"]["promo"]["f1-score"] = 0.9
    new["spam_counts"]["false_positive"] = 1
    reasons = retrain.promotion_reasons(old, new)
    assert len(reasons) == 3


def test_model_hot_reload_and_corrupt_artifact_retains_incumbent(tmp_path, monkeypatch):
    monkeypatch.setattr(runtime, "_runtime_classifier", None)
    monkeypatch.setattr(runtime, "_runtime_revision", None)
    monkeypatch.setattr(
        runtime, "_resolve_local_model", lambda: (tmp_path / "seed", "a" * 64)
    )
    seed = ProbabilityModel()
    original_load = joblib.load
    monkeypatch.setattr(
        runtime.joblib,
        "load",
        lambda p: seed if Path(p).name == "seed" else original_load(p),
    )
    revision = [None]
    monkeypatch.setattr(runtime, "active_model", lambda: revision[0])
    assert runtime.get_runtime_classifier().model is seed
    model_path = tmp_path / "new.joblib"
    joblib.dump(ProbabilityModel("purchases"), model_path)
    digest = hashlib.sha256(model_path.read_bytes()).hexdigest()
    revision[0] = (model_path, digest)
    promoted = runtime.get_runtime_classifier()
    assert promoted.model_version == f"sha256:{digest[:12]}"
    assert promoted.predict(row("check")).category == "purchases"
    revision[0] = (tmp_path / "broken.joblib", "0" * 64)
    assert runtime.get_runtime_classifier() is promoted


def test_remote_pointer_refresh_retains_cache_on_backend_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX", "retrain/")
    monkeypatch.setattr(artifacts, "_active_model", None)
    monkeypatch.setattr(artifacts, "_active_checked_at", float("-inf"))
    clock = [100.0]
    monkeypatch.setattr(artifacts.time, "monotonic", lambda: clock[0])
    remote = Mock()
    pointer = (tmp_path / "model.joblib", "a" * 64)
    remote.promoted_model.side_effect = [pointer, OSError("unavailable")]
    monkeypatch.setattr(storage, "get_store", lambda: remote)
    assert artifacts.active_model() == pointer
    clock[0] += 1
    assert artifacts.active_model() == pointer
    assert remote.promoted_model.call_count == 1
    clock[0] += 30
    assert artifacts.active_model() == pointer
    assert remote.promoted_model.call_count == 2


def test_retrain_routes_require_auth_and_opt_in(tmp_path, monkeypatch):
    monkeypatch.setenv("EMAIL_CLASSIFIER_API_TOKEN", "test-token")
    monkeypatch.delenv("EMAIL_CLASSIFIER_RETRAIN_ENABLED", raising=False)
    monkeypatch.setattr(storage, "get_store", lambda: MemoryStore())
    client = TestClient(main.app)
    assert client.post("/api/retrain").status_code == 401
    headers = {"Authorization": "Bearer test-token"}
    assert client.post("/api/retrain", headers=headers).status_code == 503
    monkeypatch.setenv("EMAIL_CLASSIFIER_RETRAIN_ENABLED", "true")
    monkeypatch.setattr(
        retrain, "start_retraining", lambda: {"status": "accepted", "run_id": "run-1"}
    )
    result = client.post("/api/retrain", headers=headers)
    assert result.status_code == 202
    assert result.json()["run_id"] == "run-1"
    assert client.get("/api/retrain", headers=headers).json()["status"] == "never-run"


def test_concurrent_triggers_share_database_lease(monkeypatch):
    monkeypatch.setenv("EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX", "retrain/")
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    remote = MemoryStore()
    remote.acquire = Mock(return_value=(False, "current"))
    monkeypatch.setattr(retrain, "get_store", lambda: remote)
    assert retrain.start_retraining() == {
        "status": "already-running",
        "run_id": "current",
    }


def test_failed_worker_emails_failure_without_exception_details(tmp_path, monkeypatch):
    notices = []
    monkeypatch.setattr(
        retrain, "notify", lambda *args: notices.append(copy.deepcopy(args))
    )
    monkeypatch.setattr(
        retrain,
        "execute",
        Mock(side_effect=ValueError("secret@example.com mongodb://password")),
    )
    remote = MemoryStore()
    monkeypatch.setattr(retrain, "get_store", lambda: remote)
    assert retrain.run_worker("failure-test") == 1
    report = remote.state["run"]
    assert report["status"] == "failed"
    assert [notice[1] for notice in notices] == ["started", "failed"]
    assert "secret@example.com" not in json.dumps(notices)
    assert report["error_type"] == "ValueError"


def test_resend_recipient_key_and_retry_idempotency(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "web-test-key")
    requests = []

    def send(request, **_kwargs):
        requests.append(request)
        if len(requests) == 1:
            raise OSError("temporary failure")
        from io import BytesIO

        return BytesIO(b'{"id":"email-id"}')

    monkeypatch.setattr(retrain, "urlopen", send)
    monkeypatch.setattr(retrain.time, "sleep", lambda _: None)
    retrain.notify("run-1", "skipped", {"reason": "unchanged"})
    payload = json.loads(requests[-1].data)
    assert payload["to"] == ["denizlg24@gmail.com"]
    assert requests[-1].get_header("Authorization") == "Bearer web-test-key"
    assert requests[0].get_header("Idempotency-key") == requests[1].get_header(
        "Idempotency-key"
    )


@pytest.mark.parametrize("improves", [True, False])
def test_execute_promotes_or_rejects_and_skips_unchanged_data(
    tmp_path, monkeypatch, improves
):
    monkeypatch.setenv("MONGODB_URI", "mongodb://unused/test")
    train = Dataset(
        tmp_path / "train.jsonl",
        tuple(row(f"train-{label}-{i}", label) for label in LABELS for i in range(6)),
    )
    evaluation = Dataset(
        tmp_path / "eval.jsonl",
        tuple(row(f"eval-{label}-{i}", label) for label in LABELS for i in range(5)),
    )
    bundle = SimpleNamespace(train=train, eval=evaluation)
    monkeypatch.setattr(retrain, "seed_dataset", lambda *_: bundle)
    remote = MemoryStore()
    monkeypatch.setattr(
        retrain,
        "correction_rows",
        lambda _: ([row(f"human-{i}") for i in range(10)], 0),
    )
    monkeypatch.setattr(
        retrain,
        "load_runtime_classifier",
        lambda: SimpleNamespace(model_version="seed"),
    )
    candidate = SimpleNamespace(pipeline=ProbabilityModel(), training_seconds=1.0)
    trainer = Mock(return_value=candidate)
    monkeypatch.setattr(retrain, "train_candidate", trainer)
    old, new = metrics(), metrics()
    for label in LABELS:
        old["per_class"][label]["f1-score"] = 0.8
        new["per_class"][label]["f1-score"] = 0.81 if improves else 0.8
    monkeypatch.setattr(retrain, "score", Mock(side_effect=[old, new]))
    previous = {"key": "retrain/old.joblib", "sha256": "a" * 64}
    remote.state["active_model"] = previous
    report = {}
    assert retrain.execute(tmp_path, "integration-run", report, remote) == (
        "promoted" if improves else "rejected"
    )
    pointer = remote.state["active_model"]
    if improves:
        assert pointer["key"] == "retrain/models/integration-run.joblib"
        assert remote.state["previous_model"] == previous
        assert "models/integration-run.joblib" in remote.objects
    else:
        assert pointer == previous
        assert report["rejection_reasons"]
    assert retrain.execute(tmp_path, "unchanged-run", {}, remote) == "skipped"
    assert trainer.call_count == 1


def test_real_training_pipeline_supports_runtime_inference(tmp_path, monkeypatch):
    from email_classifier import train
    from email_classifier.models import candidate_configs

    dataset = Dataset(
        tmp_path / "train.jsonl",
        tuple(
            row(f"{label}-independent-{i}", label) for label in LABELS for i in range(5)
        ),
    )
    config = candidate_configs("logistic-regression")[0]
    monkeypatch.setattr(train, "candidate_configs", lambda _: [config])
    candidate = train.train_candidate(dataset, "logistic-regression")
    model = runtime.RuntimeClassifier(
        candidate.pipeline,
        tuple(str(c) for c in candidate.pipeline.named_steps["classifier"].classes_),
        "test",
    )
    prediction = model.predict(row("scheduled-independent-unseen"))
    assert prediction.category in LABELS
    assert set(prediction.probabilities) == set(LABELS)
    assert sum(prediction.probabilities.values()) == pytest.approx(1.0)


def test_legacy_holdout_group_excludes_new_thread_siblings(tmp_path):
    train, evaluation = datasets(tmp_path)
    anchor = {**evaluation.rows[0], "group_id": "export-thread"}
    sibling = row("new-sibling", group="export-thread")
    _, count = retrain.merge_corrections(train, evaluation, [anchor, sibling])
    assert count == 0


def test_export_requires_human_evidence_and_skips_incomplete_bodies():
    db = Mock()
    docs = [
        {
            "emailId": "id",
            "accountId": "account",
            "category": "fyi",
            "email": {
                "subject": "Hello",
                "from": [{"address": "a@example.com"}],
                "threadId": "thread",
            },
            "body": {"text": "Hello there", "html": "", "attachmentCount": 1},
        },
        {
            "emailId": "skip",
            "accountId": "account",
            "category": "fyi",
            "email": {},
            "body": {"text": "", "html": "<p>Hello</p>"},
        },
    ]
    db.emailtriages.aggregate.return_value = docs
    rows, skipped = retrain.correction_rows(db)
    assert len(rows) == 1
    assert skipped == 1
    assert rows[0]["group_id"] == "account:thread"
    query = db.emailtriages.aggregate.call_args.args[0][0]["$match"]
    assert query["$or"][1] == {"userStatus": "reviewed", "reviewRequired": False}


def test_trigger_spawns_worker_without_secrets_in_arguments(monkeypatch):
    monkeypatch.setenv("EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX", "retrain/")
    monkeypatch.setenv("RESEND_API_KEY", "test-key")
    remote = MemoryStore()
    remote.acquire = lambda run_id: (True, run_id)
    monkeypatch.setattr(retrain, "get_store", lambda: remote)
    spawn = Mock()
    monkeypatch.setattr(retrain.subprocess, "Popen", spawn)
    result = retrain.start_retraining()
    assert result["status"] == "accepted"
    argv = spawn.call_args.args[0]
    assert argv[-2:] == ["--run-id", result["run_id"]]
    assert "test-key" not in str(argv)
    assert "pass_fds" not in spawn.call_args.kwargs


def recovery_rows():
    import hashlib

    rows = []
    for label in LABELS:
        train_count, eval_count, index = 0, 0, 0
        while train_count < 6 or eval_count < 5:
            group = f"{label}-recovery-thread-{index}"
            reserved = int(hashlib.sha256(group.encode()).hexdigest(), 16) % 5 == 0
            index += 1
            if reserved and eval_count >= 5 or not reserved and train_count >= 6:
                continue
            example = row(group, label)
            example.update(
                received_at="2040-01-01T00:00:00+00:00",
                ingested_at="2040-01-01T00:00:00+00:00",
            )
            rows.append(example)
            if reserved:
                eval_count += 1
            else:
                train_count += 1
    return rows


def test_missing_seed_starts_recovery_and_emails_missing_category_counts(tmp_path):
    from email_classifier.recovery import seed_dataset

    report = {}
    assert seed_dataset(tmp_path, [row("historical-review")], report) is None
    assert (tmp_path / "recovery.json").exists()
    assert not (tmp_path / "seed").exists()
    assert report["recovery"]["training_per_category"]["fyi"] == 1
    assert report["recovery"]["validation_per_category"]["fyi"] == 0
    cutoff = report["recovery"]["validation_after"]
    next_report = {}
    seed_dataset(tmp_path, [], next_report)
    assert next_report["recovery"]["validation_after"] == cutoff


def test_recovery_builds_valid_seed_and_freezes_it(tmp_path):
    from email_classifier.recovery import seed_dataset

    write_json(tmp_path / "recovery.json", {"started_at": "2030-01-01T00:00:00+00:00"})
    report = {}
    bundle = seed_dataset(tmp_path, recovery_rows(), report)
    assert report["seed_recovered"] is True
    assert len(bundle.train.rows) == 42
    assert len(bundle.eval.rows) == 35
    assert not (set(bundle.train.groups) & set(bundle.eval.groups))
    assert all(count == 5 for count in bundle.eval.distribution.values())
    # Later database changes cannot silently regenerate the validation split.
    second = seed_dataset(tmp_path, [], {})
    assert second.eval.rows == bundle.eval.rows
    assert second.manifest["source"] == "human-reviewed-mongodb-recovery"


def test_historical_or_backfilled_mail_cannot_become_recovery_validation(tmp_path):
    from email_classifier.recovery import recover_seed

    write_json(tmp_path / "recovery.json", {"started_at": "2030-01-01T00:00:00+00:00"})
    rows = recovery_rows()
    for index, example in enumerate(rows):
        if index % 2:
            example["received_at"] = "2020-01-01T00:00:00+00:00"
        else:
            example["ingested_at"] = "2020-01-01T00:00:00+00:00"
    report = {}
    assert recover_seed(tmp_path, rows, report) is None
    assert set(report["recovery"]["validation_per_category"].values()) == {0}


def test_recovery_keeps_duplicate_content_and_threads_in_one_split(tmp_path):
    from email_classifier.recovery import recover_seed

    write_json(tmp_path / "recovery.json", {"started_at": "2030-01-01T00:00:00+00:00"})
    rows = recovery_rows()
    duplicate = {**rows[0], "id": "other-account-copy", "group_id": "other-thread"}
    # A historical copy disqualifies the whole duplicate component from validation.
    duplicate["received_at"] = "2020-01-01T00:00:00+00:00"
    rows.append(duplicate)
    report = {}
    bundle = recover_seed(tmp_path, rows, report)
    if bundle is not None:
        from email_classifier.data import _content_hash

        assert not (
            {_content_hash(r) for r in bundle.train.rows}
            & {_content_hash(r) for r in bundle.eval.rows}
        )
    else:
        assert not (tmp_path / "seed").exists()


def test_partial_or_missing_custom_seed_does_not_silently_rebuild(
    tmp_path, monkeypatch
):
    from email_classifier.data import DatasetError
    from email_classifier.recovery import seed_dataset

    monkeypatch.setenv(
        "EMAIL_CLASSIFIER_TRAIN_PATH", str(tmp_path / "custom/train.jsonl")
    )
    with pytest.raises(DatasetError, match="custom seed"):
        seed_dataset(tmp_path, [], {})
    monkeypatch.delenv("EMAIL_CLASSIFIER_TRAIN_PATH")
    (tmp_path / "seed").mkdir()
    (tmp_path / "seed/train.jsonl").write_text("")
    with pytest.raises(DatasetError, match="partial seed"):
        seed_dataset(tmp_path, [], {})


def test_execute_without_seed_waits_for_reviews_without_training(tmp_path, monkeypatch):
    monkeypatch.setenv("MONGODB_URI", "mongodb://unused/test")
    remote = MemoryStore()
    monkeypatch.setattr(retrain, "correction_rows", lambda _: ([], 0))
    trainer = Mock()
    monkeypatch.setattr(retrain, "train_candidate", trainer)
    report = {}
    assert retrain.execute(tmp_path, "recovery-test", report, remote) == "skipped"
    assert "recovering missing seed data" in report["reason"]
    assert report["recovery"]["training_per_category"]["spam"] == 0
    trainer.assert_not_called()
    assert not (tmp_path / "active.json").exists()


def test_rollback_route_requires_auth_and_reports_busy_lease(monkeypatch):
    monkeypatch.setenv("EMAIL_CLASSIFIER_API_TOKEN", "test-token")
    monkeypatch.setenv("EMAIL_CLASSIFIER_RETRAIN_ENABLED", "true")
    remote = Mock()
    remote.rollback.return_value = {
        "status": "rolled-back",
        "model_version": "bootstrap",
    }
    monkeypatch.setattr(storage, "get_store", lambda: remote)
    client = TestClient(main.app)
    assert client.post("/api/retrain/rollback").status_code == 401
    headers = {"Authorization": "Bearer test-token"}
    response = client.post("/api/retrain/rollback", headers=headers)
    assert response.status_code == 200
    assert response.json()["model_version"] == "bootstrap"
    remote.rollback.side_effect = storage.LeaseLost("busy")
    assert client.post("/api/retrain/rollback", headers=headers).status_code == 409


def test_expired_worker_cannot_publish_or_send_completion(monkeypatch):
    remote = Mock()
    remote.update.side_effect = storage.LeaseLost("expired")
    monkeypatch.setattr(retrain, "get_store", lambda: remote)
    notify = Mock()
    monkeypatch.setattr(retrain, "notify", notify)
    assert retrain.run_worker("expired") == 1
    remote.finish.assert_not_called()
    notify.assert_not_called()
