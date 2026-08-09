"""FastAPI application for the Vercel email classifier."""

from __future__ import annotations

import hmac
import logging
import os
import sys
from pathlib import Path
from typing import Annotated

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StringConstraints
from starlette.middleware.base import RequestResponseEndpoint
from starlette.responses import Response

PUBLIC_ROOT = Path(__file__).resolve().parent / "public"
SOURCE_ROOT = str(Path(__file__).resolve().parent / "src")
if SOURCE_ROOT not in sys.path:
    sys.path.insert(0, SOURCE_ROOT)

from email_classifier.runtime import (  # noqa: E402
    RuntimeConfigurationError,
    get_runtime_classifier,
)

DEFAULT_MAX_REQUEST_BYTES = 4_000_000
MAX_TEXT_CHARACTERS = 3_900_000

ShortText = Annotated[str, StringConstraints(strict=True, max_length=10_000)]
BodyText = Annotated[
    str,
    StringConstraints(strict=True, max_length=MAX_TEXT_CHARACTERS),
]
AttachmentCount = Annotated[int, Field(strict=True, ge=0, le=10_000)]


class EmailClassificationRequest(BaseModel):
    """Validated email fields accepted by the classifier."""

    model_config = ConfigDict(extra="ignore")

    subject: ShortText = ""
    body: BodyText = ""
    sender_name: ShortText = ""
    sender_address: ShortText = ""
    attachment_count: AttachmentCount = 0
    has_html: StrictBool = False


class ClassificationResponse(BaseModel):
    """Public classifier prediction contract."""

    category: str
    confidence: float
    probabilities: dict[str, float]
    model_version: str


class ReadinessResponse(BaseModel):
    """Authenticated classifier readiness metadata."""

    status: str
    model_version: str


class APIError(Exception):
    """An expected API failure safe to return to clients."""

    def __init__(self, status_code: int, message: str) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.message = message


app = FastAPI(
    title="Email Classifier API",
    description="Authenticated personalized inbox classification.",
    version="1.0.0",
)
bearer_scheme = HTTPBearer(auto_error=False)


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


logger = logging.getLogger("email-classifier")


def _error_response(status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": message},
    )


def require_authorization(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
) -> None:
    """Require the shared classifier Bearer token."""
    expected = os.getenv("EMAIL_CLASSIFIER_API_TOKEN", "")
    if not expected:
        raise APIError(503, "classifier unavailable")
    if credentials is None or not hmac.compare_digest(
        credentials.credentials,
        expected,
    ):
        raise APIError(401, "unauthorized")


@app.middleware("http")
async def secure_and_limit_requests(
    request: Request,
    call_next: RequestResponseEndpoint,
) -> Response:
    """Limit classification bodies and apply API security headers."""
    response: Response
    if request.method == "POST" and request.url.path == "/api/classify":
        content_length_header = request.headers.get("content-length")
        if content_length_header is None:
            response = _error_response(400, "Content-Length is required")
        else:
            try:
                content_length = int(content_length_header)
                max_request_bytes = _configured_max_request_bytes()
            except ValueError:
                response = _error_response(400, "invalid Content-Length")
            except RuntimeConfigurationError:
                response = _error_response(503, "classifier unavailable")
            else:
                if not 0 < content_length <= max_request_bytes:
                    response = _error_response(413, "request body is too large")
                else:
                    response = await call_next(request)
    else:
        response = await call_next(request)

    response.headers.setdefault("Cache-Control", "no-store")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


@app.exception_handler(APIError)
async def handle_api_error(_request: Request, exc: APIError) -> JSONResponse:
    """Return the stable public error envelope."""
    if exc.status_code >= 500:
        logger.error(exc.message, exc_info=exc.__cause__ or exc)
    return _error_response(exc.status_code, exc.message)


@app.exception_handler(RequestValidationError)
async def handle_validation_error(
    _request: Request,
    _exc: RequestValidationError,
) -> JSONResponse:
    """Avoid exposing validation internals in production responses."""
    return _error_response(400, "invalid request")


@app.get(
    "/api/classify",
    response_model=ReadinessResponse,
    dependencies=[Depends(require_authorization)],
)
def readiness() -> ReadinessResponse:
    """Return authenticated readiness and model version metadata."""
    try:
        classifier = get_runtime_classifier()
    except RuntimeConfigurationError as exc:
        raise APIError(503, "classifier unavailable") from exc
    return ReadinessResponse(
        status="ready",
        model_version=classifier.model_version,
    )


@app.post(
    "/api/classify",
    response_model=ClassificationResponse,
    dependencies=[Depends(require_authorization)],
)
def classify_email(email: EmailClassificationRequest) -> ClassificationResponse:
    """Classify one complete email body."""
    try:
        prediction = get_runtime_classifier().predict(email.model_dump())
    except RuntimeConfigurationError as exc:
        raise APIError(503, "classifier unavailable") from exc
    except Exception as exc:
        print(f"[classify] request failed: {type(exc).__name__}")
        raise APIError(500, "classification failed") from exc

    return ClassificationResponse(
        category=prediction.category,
        confidence=prediction.confidence,
        probabilities=prediction.probabilities,
        model_version=prediction.model_version,
    )


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def root() -> FileResponse:
    """Serve the classification playground."""
    return FileResponse(
        PUBLIC_ROOT / "index.html",
        media_type="text/html; charset=utf-8",
        headers={"Cache-Control": "public, max-age=0, must-revalidate"},
    )

@app.get("/env")
def env() -> JSONResponse:
    """Return the environment for preview debugging."""
    return JSONResponse(
        status_code=200,
        content=dict(os.environ),
    )


@app.get("/favicon.ico", include_in_schema=False)
def favicon() -> FileResponse:
    """Serve the icon directly; the runtime does not publish `public/`."""
    return FileResponse(
        PUBLIC_ROOT / "favicon.ico",
        media_type="image/x-icon",
        headers={"Cache-Control": "public, max-age=86400"},
    )
