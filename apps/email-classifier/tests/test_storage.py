from __future__ import annotations

import hashlib
import os
import uuid
from datetime import UTC, datetime
from io import BytesIO

import pytest
from pymongo import MongoClient
from test_retrain import recovery_rows

from email_classifier.recovery import seed_dataset
from email_classifier.storage import LeaseLost, RemoteStore


class MemoryS3:
    def __init__(self):
        self.objects = {}
        self.corrupt = False

    def put_object(self, *, Bucket, Key, Body, **kwargs):
        self.objects[(Bucket, Key)] = Body.read()
        return {}

    def get_object(self, *, Bucket, Key):
        content = self.objects[(Bucket, Key)]
        if self.corrupt:
            content = b"corrupt"
        return {"Body": BytesIO(content), "ContentLength": len(content)}


@pytest.fixture
def remote():
    uri = os.getenv("EMAIL_CLASSIFIER_TEST_MONGO_URI")
    if not uri:
        pytest.skip("Set EMAIL_CLASSIFIER_TEST_MONGO_URI to a disposable MongoDB")
    client = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=10000)
    database = client[f"classifier_tests_{uuid.uuid4().hex}"]
    store = RemoteStore(database, MemoryS3(), "private-bucket", "retrain/", "test")
    try:
        yield store
    finally:
        client.drop_database(database.name)
        client.close()


def test_durable_lease_serializes_workers_and_fences_expired_owner(remote):
    other = RemoteStore(
        remote.db, remote.s3, remote.bucket, remote.prefix, remote.namespace
    )
    assert remote.acquire("first") == (True, "first")
    assert other.acquire("second") == (False, "first")
    remote.states.update_one(
        {"_id": remote.namespace},
        {"$set": {"lease_expires": datetime(2000, 1, 1, tzinfo=UTC)}},
    )
    assert remote.status()["error_type"] == "WorkerLeaseExpired"
    assert other.acquire("second") == (True, "second")
    with pytest.raises(LeaseLost):
        remote.promote("first", {"key": "retrain/old", "sha256": "a" * 64})
    with pytest.raises(LeaseLost):
        remote.finish("first", {"status": "failed"})
    assert other.status()["run_id"] == "second"
    other.finish("second", {"run_id": "second", "status": "skipped"})
    assert remote.status()["status"] == "skipped"
    assert remote.acquire("third") == (True, "third")


def test_seed_and_recovery_survive_discarding_all_local_files(remote, tmp_path):
    first = tmp_path / "first"
    first.mkdir()
    assert remote.acquire("seed-run")[0]
    remote.prepare(first, "seed-run")
    cutoff = remote.read()["recovery"]["started_at"]
    bundle = seed_dataset(first, recovery_rows(), {})
    assert bundle is not None
    remote.persist_seed(first, "seed-run")
    remote.finish("seed-run", {"status": "skipped", "run_id": "seed-run"})
    second = tmp_path / "second"
    second.mkdir()
    assert remote.acquire("restart-run")[0]
    remote.prepare(second, "restart-run")
    restored = seed_dataset(second, [], {})
    assert restored.train.rows == bundle.train.rows
    assert restored.eval.rows == bundle.eval.rows
    assert remote.read()["recovery"]["started_at"] == cutoff
    assert len(remote.read()["seed"]) == 3


def test_seed_pointer_is_not_published_after_corrupt_upload(remote, tmp_path):
    remote.acquire("seed-run")
    remote.prepare(tmp_path, "seed-run")
    seed_dataset(tmp_path, recovery_rows(), {})
    remote.s3.corrupt = True
    with pytest.raises(ValueError, match="SHA-256"):
        remote.persist_seed(tmp_path, "seed-run")
    assert "seed" not in remote.read()
    # The cutoff was persisted before attempting any export or upload.
    assert remote.read()["recovery"]["started_at"]


def test_model_upload_validation_and_rollback(remote, tmp_path, monkeypatch):
    remote.acquire("model-run")
    model = tmp_path / "model.joblib"
    model.write_bytes(b"verified-model-test-bytes")
    pointer = remote.upload(model, "models/model-run.joblib", limit=10000)
    assert pointer["sha256"] == hashlib.sha256(model.read_bytes()).hexdigest()
    remote.promote("model-run", pointer)
    with pytest.raises(LeaseLost):
        remote.rollback()
    remote.finish("model-run", {"run_id": "model-run", "status": "promoted"})
    downloaded = tmp_path / "different-container" / "model.joblib"
    remote.download(pointer, downloaded, limit=10000)
    assert downloaded.read_bytes() == model.read_bytes()
    assert remote.rollback() == {"status": "rolled-back", "model_version": "bootstrap"}
    assert remote.read()["active_model"] is None
    remote.rollback()
    assert remote.read()["active_model"] == pointer


def test_upload_failure_keeps_incumbent_pointer(remote, tmp_path):
    remote.acquire("run")
    original = {"key": "retrain/previous.joblib", "sha256": "a" * 64}
    remote.update("run", {"active_model": original})
    model = tmp_path / "new.joblib"
    model.write_bytes(b"model")
    remote.s3.corrupt = True
    with pytest.raises(ValueError, match="SHA-256"):
        pointer = remote.upload(model, "models/new.joblib", limit=1000)
        remote.promote("run", pointer)
    assert remote.read()["active_model"] == original


def test_download_rejects_oversize_wrong_digest_and_outside_prefix(remote, tmp_path):
    path = tmp_path / "model"
    path.write_bytes(b"original")
    pointer = {"key": "retrain/model", "sha256": "a" * 64}
    remote.s3.objects[(remote.bucket, pointer["key"])] = b"data"
    with pytest.raises(ValueError, match="size"):
        remote.download(pointer, path, limit=2)
    with pytest.raises(ValueError, match="SHA-256"):
        remote.download(pointer, path, limit=1000)
    assert path.read_bytes() == b"original"
    pointer["key"] = "bootstrap/original.joblib"
    with pytest.raises(ValueError, match="prefix"):
        remote.download(pointer, path, limit=1000)


def test_status_and_run_history_are_shared_between_instances(remote):
    remote.acquire("run")
    remote.update("run", {"run": {"run_id": "run", "status": "started"}})
    report = {"run_id": "run", "status": "rejected", "notification_error": "OSError"}
    remote.finish("run", report)
    other = RemoteStore(
        remote.db, remote.s3, remote.bucket, remote.prefix, remote.namespace
    )
    assert other.status() == report
    assert remote.runs.find_one({"_id": "test:run"})["status"] == "rejected"
    assert "lease_owner" not in remote.read()
