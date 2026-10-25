"""S3 artifacts and fenced MongoDB state; local files are disposable caches."""

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from contextlib import suppress
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import boto3
from botocore.config import Config
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError

from email_classifier.artifacts import verify_artifact, write_json

LEASE_MINUTES = 135
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


class LeaseLost(RuntimeError):
    """A worker no longer owns the right to publish state."""


def remote_enabled() -> bool:
    return bool(os.getenv("EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX", "").strip())


class RemoteStore:
    def __init__(
        self, db: Any, s3: Any, bucket: str, prefix: str, namespace: str
    ) -> None:
        self.db, self.s3, self.bucket = db, s3, bucket
        self.prefix, self.namespace = prefix, namespace
        self.states = db.emailclassifierstates
        self.runs = db.emailclassifierruns

    def key(self, suffix: str) -> str:
        return self.prefix + suffix

    def read(self) -> dict[str, Any]:
        return self.states.find_one({"_id": self.namespace}) or {}

    def _owned(self, run_id: str) -> dict[str, Any]:
        return {
            "_id": self.namespace,
            "lease_owner": run_id,
            "$expr": {"$gt": ["$lease_expires", "$$NOW"]},
        }

    def update(self, run_id: str, fields: dict[str, Any]) -> None:
        result = self.states.update_one(self._owned(run_id), {"$set": fields})
        if result.matched_count != 1:
            raise LeaseLost("retraining lease expired or was replaced")

    def acquire(self, run_id: str) -> tuple[bool, str]:
        with suppress(DuplicateKeyError):
            self.states.update_one(
                {"_id": self.namespace},
                {"$setOnInsert": {"schema_version": 1}},
                upsert=True,
            )
        query = {
            "_id": self.namespace,
            "$expr": {"$lte": [{"$ifNull": ["$lease_expires", EPOCH]}, "$$NOW"]},
        }
        result = self.states.find_one_and_update(
            query,
            [
                {
                    "$set": {
                        "lease_owner": {"$literal": run_id},
                        "lease_expires": {
                            "$dateAdd": {
                                "startDate": "$$NOW",
                                "unit": "minute",
                                "amount": LEASE_MINUTES,
                            }
                        },
                        "run": {"$literal": {"run_id": run_id, "status": "queued"}},
                    }
                }
            ],
            return_document=ReturnDocument.AFTER,
        )
        if result is not None:
            return True, run_id
        return False, self.read().get("run", {}).get("run_id", "unknown")

    def finish(self, run_id: str, report: dict[str, Any]) -> None:
        # Terminal state is exposed only after notification delivery is attempted.
        # Releasing and recording the result are a single fenced document update.
        result = self.states.update_one(
            self._owned(run_id),
            {
                "$set": {"run": report},
                "$unset": {"lease_owner": "", "lease_expires": ""},
            },
        )
        if result.matched_count != 1:
            raise LeaseLost("cannot finish a run after losing its lease")
        self.runs.replace_one(
            {"_id": f"{self.namespace}:{run_id}"},
            {"_id": f"{self.namespace}:{run_id}", **report},
            upsert=True,
        )

    def status(self) -> dict[str, Any]:
        state = self.read()
        report = dict(state.get("run") or {"status": "never-run"})
        if report["status"] in {"queued", "started"}:
            expired = self.states.find_one(
                {
                    "_id": self.namespace,
                    "$expr": {
                        "$lte": [{"$ifNull": ["$lease_expires", EPOCH]}, "$$NOW"]
                    },
                }
            )
            if expired is not None:
                report.update(status="failed", error_type="WorkerLeaseExpired")
        return report

    def _check_key(self, key: str) -> None:
        if not key.startswith(self.prefix) or ".." in key.split("/"):
            raise ValueError("artifact key must be inside the retraining prefix")

    def download(self, pointer: dict[str, Any], path: Path, *, limit: int) -> None:
        key, digest = pointer["key"], pointer["sha256"]
        self._check_key(key)
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or any(c not in "0123456789abcdef" for c in digest)
        ):
            raise ValueError("invalid artifact digest")
        if path.exists() and path.stat().st_size <= limit:
            with path.open("rb") as handle:
                if hashlib.file_digest(handle, "sha256").hexdigest() == digest:
                    return
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        response = self.s3.get_object(Bucket=self.bucket, Key=key)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        hashed, count = hashlib.sha256(), 0
        try:
            if response.get("ContentLength", 0) > limit:
                raise ValueError("S3 artifact exceeds its size limit")
            with temporary.open("wb") as output:
                while chunk := response["Body"].read(1024 * 1024):
                    count += len(chunk)
                    if count > limit:
                        raise ValueError("S3 artifact exceeds its size limit")
                    hashed.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if hashed.hexdigest() != digest:
                raise ValueError("S3 artifact SHA-256 mismatch")
            temporary.replace(path)
        finally:
            response["Body"].close()
            temporary.unlink(missing_ok=True)

    def upload(self, path: Path, suffix: str, *, limit: int) -> dict[str, str]:
        if path.stat().st_size > limit:
            raise ValueError("artifact exceeds its size limit")
        with path.open("rb") as handle:
            digest = hashlib.file_digest(handle, "sha256").hexdigest()
        pointer = {"key": self.key(suffix), "sha256": digest}
        with path.open("rb") as handle:
            self.s3.put_object(
                Bucket=self.bucket,
                Key=pointer["key"],
                Body=handle,
                ContentType="application/octet-stream",
            )
        # Read back and hash before any MongoDB pointer can reference this upload.
        with tempfile.TemporaryDirectory(prefix="classifier-verify-") as directory:
            self.download(pointer, Path(directory) / "artifact", limit=limit)
        return pointer

    def prepare(self, root: Path, run_id: str) -> None:
        state = self.read()
        if not state.get("recovery"):
            state["recovery"] = {"started_at": datetime.now(UTC).isoformat()}
            self.update(run_id, {"recovery": state["recovery"]})
        write_json(root / "recovery.json", state["recovery"])
        if state.get("seed"):
            for filename, pointer in state["seed"].items():
                if filename not in {"train.jsonl", "eval.jsonl", "manifest.json"}:
                    raise ValueError("invalid seed manifest")
                self.download(
                    pointer, root / "seed" / filename, limit=256 * 1024 * 1024
                )

    def persist_seed(self, root: Path, run_id: str) -> None:
        state = self.read()
        if (root / "recovery.json").exists() and not state.get("recovery"):
            self.update(
                run_id, {"recovery": json.loads((root / "recovery.json").read_text())}
            )
        if (root / "seed").exists() and not state.get("seed"):
            pointers = {
                name: self.upload(
                    root / "seed" / name,
                    f"seeds/{run_id}/{name}",
                    limit=256 * 1024 * 1024,
                )
                for name in ("train.jsonl", "eval.jsonl", "manifest.json")
            }
            self.update(run_id, {"seed": pointers})

    def promoted_model(self) -> tuple[Path, str] | None:
        pointer = self.read().get("active_model")
        if not pointer:
            return None
        digest = pointer["sha256"]
        # Validate pointer before constructing a filename using its digest.
        self._check_key(pointer["key"])
        if (
            not isinstance(digest, str)
            or len(digest) != 64
            or not all(c in "0123456789abcdef" for c in digest)
        ):
            raise ValueError("invalid active model digest")
        path = (
            Path(tempfile.gettempdir()) / "email-classifier-models" / f"{digest}.joblib"
        )
        self.download(pointer, path, limit=100 * 1024 * 1024)
        verify_artifact(path, digest)
        return path, digest

    def promote(self, run_id: str, pointer: dict[str, str]) -> None:
        old = self.read().get("active_model")
        self.update(run_id, {"active_model": pointer, "previous_model": old})

    def rollback(self) -> dict[str, Any]:
        state = self.read()
        if "previous_model" not in state:
            raise ValueError("no previous model is available")
        pointer = state["previous_model"]
        if pointer:
            with tempfile.TemporaryDirectory(
                prefix="classifier-rollback-"
            ) as directory:
                self.download(
                    pointer, Path(directory) / "model.joblib", limit=100 * 1024 * 1024
                )
        query = {
            "_id": self.namespace,
            "active_model": state.get("active_model"),
            "$expr": {"$lte": [{"$ifNull": ["$lease_expires", EPOCH]}, "$$NOW"]},
        }
        result = self.states.update_one(
            query,
            {
                "$set": {
                    "active_model": pointer,
                    "previous_model": state.get("active_model"),
                }
            },
        )
        if result.matched_count != 1:
            raise LeaseLost(
                "cannot roll back during training or a concurrent promotion"
            )
        return {
            "status": "rolled-back",
            "model_version": (
                f"sha256:{pointer['sha256'][:12]}" if pointer else "bootstrap"
            ),
        }


@lru_cache(maxsize=1)
def get_store() -> RemoteStore:
    endpoint = os.environ["EMAIL_CLASSIFIER_MODEL_S3_ENDPOINT"].strip()
    parsed = urlparse(endpoint)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("S3 endpoint must use HTTPS")
    bucket = os.environ["EMAIL_CLASSIFIER_MODEL_S3_BUCKET"]
    prefix = os.environ["EMAIL_CLASSIFIER_RETRAIN_S3_PREFIX"].strip().strip("/") + "/"
    if prefix == "/" or ".." in prefix.split("/"):
        raise ValueError("a dedicated retraining S3 prefix is required")
    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=os.environ["EMAIL_CLASSIFIER_MODEL_S3_REGION"],
        aws_access_key_id=os.environ["EMAIL_CLASSIFIER_MODEL_S3_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["EMAIL_CLASSIFIER_MODEL_S3_SECRET_ACCESS_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            retries={"max_attempts": 3, "mode": "standard"},
            connect_timeout=10,
            read_timeout=30,
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
        ),
    )
    client = MongoClient(
        os.environ["MONGODB_URI"],
        tz_aware=True,
        w="majority",
        readConcernLevel="majority",
        serverSelectionTimeoutMS=15_000,
        connectTimeoutMS=15_000,
        socketTimeoutMS=120_000,
    )
    namespace = hashlib.sha256(f"{endpoint}|{bucket}|{prefix}".encode()).hexdigest()
    return RemoteStore(
        client.get_default_database("test"), s3, bucket, prefix, namespace
    )
