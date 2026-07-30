"""Production model loading and prediction for the serverless classifier."""

from __future__ import annotations

import hashlib
import hmac
import os
import re
import tempfile
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlparse
from urllib.request import Request, urlopen

import joblib

from email_classifier.data import LABELS, prepare_inference_row

MAX_MODEL_BYTES = 100 * 1024 * 1024
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
EMPTY_PAYLOAD_SHA256 = hashlib.sha256(b"").hexdigest()
USER_AGENT = "denizlg24-email-classifier/1"
S3_ENV_NAMES = (
    "EMAIL_CLASSIFIER_MODEL_S3_ENDPOINT",
    "EMAIL_CLASSIFIER_MODEL_S3_REGION",
    "EMAIL_CLASSIFIER_MODEL_S3_ACCESS_KEY_ID",
    "EMAIL_CLASSIFIER_MODEL_S3_SECRET_ACCESS_KEY",
    "EMAIL_CLASSIFIER_MODEL_S3_BUCKET",
    "EMAIL_CLASSIFIER_MODEL_S3_KEY",
)


class RuntimeConfigurationError(RuntimeError):
    """Raised when the runtime model cannot be loaded safely."""


@dataclass(frozen=True)
class ClassificationPrediction:
    """One normalized classifier prediction."""

    category: str
    confidence: float
    probabilities: dict[str, float]
    model_version: str


@dataclass(frozen=True)
class RuntimeClassifier:
    """Loaded probability model and its deployment metadata."""

    model: Any
    classes: tuple[str, ...]
    model_version: str

    def predict(self, raw_email: dict[str, Any]) -> ClassificationPrediction:
        """Classify one email and return its complete probability distribution."""
        row = prepare_inference_row(raw_email)
        probabilities = self.model.predict_proba([row])
        if len(probabilities) != 1:
            raise RuntimeError("classifier returned an unexpected probability shape")

        values = [float(value) for value in probabilities[0]]
        if len(values) != len(self.classes):
            raise RuntimeError("classifier class and probability counts differ")

        probability_map = dict(zip(self.classes, values, strict=True))
        category = str(self.model.predict([row])[0])
        if category not in probability_map:
            raise RuntimeError("classifier returned an unknown category")

        return ClassificationPrediction(
            category=category,
            confidence=max(values),
            probabilities=probability_map,
            model_version=self.model_version,
        )


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(DOWNLOAD_CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_sha256(value: str) -> str:
    normalized = value.strip().casefold()
    if len(normalized) != 64 or any(
        character not in "0123456789abcdef" for character in normalized
    ):
        raise RuntimeConfigurationError(
            "EMAIL_CLASSIFIER_MODEL_SHA256 must be a 64-character SHA-256 digest"
        )
    return normalized


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeConfigurationError(f"{name} must be configured")
    return value


def _cache_destination(expected_digest: str) -> Path:
    cache_root = Path(tempfile.gettempdir()) / "email-classifier-models"
    cache_root.mkdir(parents=True, exist_ok=True)
    return cache_root / f"{expected_digest}.joblib"


def _cached_model(expected_digest: str) -> Path | None:
    destination = _cache_destination(expected_digest)
    if destination.is_file() and _sha256(destination) == expected_digest:
        return destination
    destination.unlink(missing_ok=True)
    return None


def _resolve_local_model() -> tuple[Path, str] | None:
    configured = os.getenv("EMAIL_CLASSIFIER_MODEL_PATH", "").strip()
    if not configured:
        return None

    path = Path(configured).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    path = path.resolve()
    if not path.is_file():
        raise RuntimeConfigurationError("configured classifier model was not found")

    digest = _sha256(path)
    expected = os.getenv("EMAIL_CLASSIFIER_MODEL_SHA256", "").strip()
    if expected and digest != _validate_sha256(expected):
        raise RuntimeConfigurationError("classifier model SHA-256 does not match")
    return path, digest


def _hmac(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _sign_s3_get(
    endpoint: str,
    region: str,
    access_key: str,
    secret_key: str,
    bucket: str,
    key: str,
) -> Request:
    """Build a SigV4 path-style GET for one S3 object."""
    parsed = urlparse(endpoint.rstrip("/"))
    canonical_uri = f"{parsed.path}/{quote(bucket, safe='')}/{quote(key, safe='/')}"
    now = datetime.now(UTC)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    scope = f"{date_stamp}/{region}/s3/aws4_request"

    canonical_headers = (
        f"host:{parsed.netloc}\n"
        f"x-amz-content-sha256:{EMPTY_PAYLOAD_SHA256}\n"
        f"x-amz-date:{amz_date}\n"
    )
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        (
            "GET",
            canonical_uri,
            "",
            canonical_headers,
            signed_headers,
            EMPTY_PAYLOAD_SHA256,
        )
    )
    string_to_sign = "\n".join(
        (
            "AWS4-HMAC-SHA256",
            amz_date,
            scope,
            hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
        )
    )

    signing_key = _hmac(
        _hmac(_hmac(_hmac(f"AWS4{secret_key}".encode(), date_stamp), region), "s3"),
        "aws4_request",
    )
    signature = hmac.new(
        signing_key, string_to_sign.encode("utf-8"), hashlib.sha256
    ).hexdigest()

    return Request(
        f"{parsed.scheme}://{parsed.netloc}{canonical_uri}",
        headers={
            "Authorization": (
                f"AWS4-HMAC-SHA256 Credential={access_key}/{scope}, "
                f"SignedHeaders={signed_headers}, Signature={signature}"
            ),
            "x-amz-content-sha256": EMPTY_PAYLOAD_SHA256,
            "x-amz-date": amz_date,
            "User-Agent": USER_AGENT,
        },
    )


def _s3_error_detail(error: HTTPError) -> str:
    """Summarize an S3 error response for server-side logs."""
    try:
        body = error.read(2048).decode("utf-8", "replace")
    except OSError:
        body = ""

    code = re.search(r"<Code>([^<]+)</Code>", body)
    message = re.search(r"<Message>([^<]+)</Message>", body)
    if code is None:
        return f"HTTP {error.code} {body[:200].strip()}".rstrip()
    detail = f"HTTP {error.code} {code.group(1)}"
    return f"{detail}: {message.group(1)}" if message else detail


def _download_s3_model() -> tuple[Path, str] | None:
    configured_values = [os.getenv(name, "").strip() for name in S3_ENV_NAMES]
    if not any(configured_values):
        return None

    endpoint, region, access_key, secret_key, bucket, key = [
        _required_env(name) for name in S3_ENV_NAMES
    ]
    parsed_endpoint = urlparse(endpoint)
    if parsed_endpoint.scheme != "https" or not parsed_endpoint.netloc:
        raise RuntimeConfigurationError(
            "EMAIL_CLASSIFIER_MODEL_S3_ENDPOINT must use HTTPS"
        )

    expected_digest = _validate_sha256(
        os.getenv("EMAIL_CLASSIFIER_MODEL_SHA256", "")
    )
    cached = _cached_model(expected_digest)
    if cached is not None:
        return cached, expected_digest

    destination = _cache_destination(expected_digest)
    temporary = destination.with_suffix(f".{os.getpid()}.tmp")
    downloaded = 0
    digest = hashlib.sha256()

    try:
        request = _sign_s3_get(endpoint, region, access_key, secret_key, bucket, key)
        with urlopen(request, timeout=30) as response:
            declared = response.headers.get("Content-Length")
            if declared is not None and int(declared) > MAX_MODEL_BYTES:
                raise RuntimeConfigurationError(
                    "classifier model exceeds the 100 MB runtime limit"
                )

            with temporary.open("wb") as output:
                while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                    downloaded += len(chunk)
                    if downloaded > MAX_MODEL_BYTES:
                        raise RuntimeConfigurationError(
                            "classifier model exceeds the 100 MB runtime limit"
                        )
                    digest.update(chunk)
                    output.write(chunk)

        if digest.hexdigest() != expected_digest:
            raise RuntimeConfigurationError(
                "downloaded classifier model SHA-256 does not match"
            )
        temporary.replace(destination)
    except HTTPError as exc:
        raise RuntimeConfigurationError(
            f"classifier model was rejected by S3 ({_s3_error_detail(exc)})"
        ) from exc
    except (OSError, TimeoutError, URLError, ValueError) as exc:
        raise RuntimeConfigurationError(
            "classifier model could not be downloaded from S3"
        ) from exc
    finally:
        temporary.unlink(missing_ok=True)

    return destination, expected_digest


def _download_remote_model() -> tuple[Path, str]:
    model_url = os.getenv("EMAIL_CLASSIFIER_MODEL_URL", "").strip()
    if not model_url:
        raise RuntimeConfigurationError(
            "configure EMAIL_CLASSIFIER_MODEL_PATH or EMAIL_CLASSIFIER_MODEL_URL"
        )

    parsed = urlparse(model_url)
    if parsed.scheme != "https":
        raise RuntimeConfigurationError("EMAIL_CLASSIFIER_MODEL_URL must use HTTPS")

    expected_digest = _validate_sha256(os.getenv("EMAIL_CLASSIFIER_MODEL_SHA256", ""))
    cached = _cached_model(expected_digest)
    if cached is not None:
        return cached, expected_digest

    destination = _cache_destination(expected_digest)
    headers = {"User-Agent": USER_AGENT}
    bearer_token = os.getenv("EMAIL_CLASSIFIER_MODEL_BEARER_TOKEN", "").strip()
    if bearer_token:
        headers["Authorization"] = f"Bearer {bearer_token}"

    request = Request(model_url, headers=headers)
    temporary = destination.with_suffix(f".{os.getpid()}.tmp")
    digest = hashlib.sha256()
    downloaded = 0
    try:
        with urlopen(request, timeout=30) as response, temporary.open("wb") as output:
            while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                downloaded += len(chunk)
                if downloaded > MAX_MODEL_BYTES:
                    raise RuntimeConfigurationError(
                        "classifier model exceeds the 100 MB runtime limit"
                    )
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != expected_digest:
            raise RuntimeConfigurationError(
                "downloaded classifier model SHA-256 does not match"
            )
        temporary.replace(destination)
    except (HTTPError, OSError, TimeoutError, URLError) as exc:
        raise RuntimeConfigurationError(
            "classifier model could not be downloaded"
        ) from exc
    finally:
        temporary.unlink(missing_ok=True)

    return destination, expected_digest


def load_runtime_classifier() -> RuntimeClassifier:
    """Load and validate the configured probability model."""
    resolved = _resolve_local_model()
    if resolved is None:
        resolved = _download_s3_model()
    path, digest = resolved if resolved is not None else _download_remote_model()

    try:
        model = joblib.load(path)
    except Exception as exc:
        raise RuntimeConfigurationError(
            "configured classifier model could not be loaded"
        ) from exc

    if not hasattr(model, "predict") or not hasattr(model, "predict_proba"):
        raise RuntimeConfigurationError(
            "production classifier must support predict and predict_proba"
        )

    try:
        classifier = model.named_steps["classifier"]
        classes = tuple(str(value) for value in classifier.classes_)
    except (AttributeError, KeyError, TypeError) as exc:
        raise RuntimeConfigurationError(
            "production classifier has an unsupported pipeline shape"
        ) from exc

    if set(classes) != set(LABELS):
        raise RuntimeConfigurationError(
            "production classifier labels do not match the triage contract"
        )

    version = (
        os.getenv("EMAIL_CLASSIFIER_MODEL_VERSION", "").strip()
        or f"sha256:{digest[:12]}"
    )
    return RuntimeClassifier(
        model=model,
        classes=classes,
        model_version=version,
    )


_runtime_classifier: RuntimeClassifier | None = None
_runtime_classifier_lock = threading.Lock()


def get_runtime_classifier() -> RuntimeClassifier:
    """Return one process-wide classifier for warm serverless invocations."""
    global _runtime_classifier

    if _runtime_classifier is not None:
        return _runtime_classifier

    with _runtime_classifier_lock:
        if _runtime_classifier is None:
            _runtime_classifier = load_runtime_classifier()
    return _runtime_classifier
