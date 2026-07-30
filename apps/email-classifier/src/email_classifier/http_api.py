"""Authenticated Vercel HTTP handler for email classification."""

from __future__ import annotations

import hmac
import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any

from email_classifier.runtime import (
    RuntimeConfigurationError,
    get_runtime_classifier,
)

DEFAULT_MAX_REQUEST_BYTES = 4_000_000
MAX_TEXT_CHARACTERS = 3_900_000


class RequestValidationError(ValueError):
    """Raised when a classification request is malformed."""


def _required_string(
    payload: dict[str, Any],
    key: str,
    *,
    max_characters: int,
) -> str:
    value = payload.get(key, "")
    if not isinstance(value, str):
        raise RequestValidationError(f"{key} must be a string")
    if len(value) > max_characters:
        raise RequestValidationError(f"{key} is too large")
    return value


def parse_email_payload(payload: Any) -> dict[str, Any]:
    """Validate and normalize the public API request shape."""
    if not isinstance(payload, dict):
        raise RequestValidationError("request body must be a JSON object")

    attachment_count = payload.get("attachment_count", 0)
    if (
        isinstance(attachment_count, bool)
        or not isinstance(attachment_count, int)
        or not 0 <= attachment_count <= 10_000
    ):
        raise RequestValidationError(
            "attachment_count must be an integer between 0 and 10000"
        )

    has_html = payload.get("has_html", False)
    if not isinstance(has_html, bool):
        raise RequestValidationError("has_html must be a boolean")

    return {
        "subject": _required_string(payload, "subject", max_characters=10_000),
        "body": _required_string(
            payload,
            "body",
            max_characters=MAX_TEXT_CHARACTERS,
        ),
        "sender_name": _required_string(
            payload,
            "sender_name",
            max_characters=10_000,
        ),
        "sender_address": _required_string(
            payload,
            "sender_address",
            max_characters=10_000,
        ),
        "attachment_count": attachment_count,
        "has_html": has_html,
    }


def _configured_max_request_bytes() -> int:
    raw_value = os.getenv(
        "EMAIL_CLASSIFIER_MAX_REQUEST_BYTES",
        str(DEFAULT_MAX_REQUEST_BYTES),
    )
    try:
        value = int(raw_value)
    except ValueError as exc:
        raise RuntimeConfigurationError(
            "EMAIL_CLASSIFIER_MAX_REQUEST_BYTES must be an integer"
        ) from exc
    if not 1 <= value <= DEFAULT_MAX_REQUEST_BYTES:
        raise RuntimeConfigurationError(
            "EMAIL_CLASSIFIER_MAX_REQUEST_BYTES must be between 1 and 4000000"
        )
    return value


class handler(BaseHTTPRequestHandler):
    """Vercel function entry point."""

    server_version = "EmailClassifier"
    sys_version = ""

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(
            payload,
            separators=(",", ":"),
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(status.value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.end_headers()
        self.wfile.write(encoded)

    def _is_authorized(self) -> bool:
        expected = os.getenv("EMAIL_CLASSIFIER_API_TOKEN", "")
        if not expected:
            raise RuntimeConfigurationError(
                "EMAIL_CLASSIFIER_API_TOKEN is not configured"
            )
        provided = self.headers.get("Authorization", "")
        prefix = "Bearer "
        if not provided.startswith(prefix):
            return False
        return hmac.compare_digest(provided[len(prefix) :], expected)

    def _require_authorization(self) -> bool:
        if self._is_authorized():
            return True
        self._send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "unauthorized"},
        )
        return False

    def do_GET(self) -> None:
        """Return authenticated readiness and model version metadata."""
        try:
            if not self._require_authorization():
                return
            classifier = get_runtime_classifier()
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ready",
                    "model_version": classifier.model_version,
                },
            )
        except RuntimeConfigurationError:
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "classifier unavailable"},
            )

    def do_POST(self) -> None:
        """Classify one complete email body."""
        try:
            if not self._require_authorization():
                return

            content_length_header = self.headers.get("Content-Length")
            if content_length_header is None:
                raise RequestValidationError("Content-Length is required")
            try:
                content_length = int(content_length_header)
            except ValueError as exc:
                raise RequestValidationError("invalid Content-Length") from exc

            if not 0 < content_length <= _configured_max_request_bytes():
                self._send_json(
                    HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    {"error": "request body is too large"},
                )
                return

            raw_body = self.rfile.read(content_length)
            try:
                payload = json.loads(raw_body.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                raise RequestValidationError(
                    "request body must be valid UTF-8 JSON"
                ) from exc

            email = parse_email_payload(payload)
            prediction = get_runtime_classifier().predict(email)
            self._send_json(
                HTTPStatus.OK,
                {
                    "category": prediction.category,
                    "confidence": prediction.confidence,
                    "probabilities": prediction.probabilities,
                    "model_version": prediction.model_version,
                },
            )
        except RequestValidationError as exc:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except RuntimeConfigurationError:
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "classifier unavailable"},
            )
        except Exception as exc:
            print(f"[classify] request failed: {type(exc).__name__}")
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "classification failed"},
            )

    def log_message(self, format: str, *args: Any) -> None:
        """Avoid logging request paths or private request metadata."""
        del format, args
