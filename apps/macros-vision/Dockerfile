FROM python:3.12-slim-bookworm AS dependencies
COPY --from=ghcr.io/astral-sh/uv:0.10.4 /uv /uvx /bin/
WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev --no-install-project

FROM python:3.12-slim-bookworm AS runtime
WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libsm6 libx11-6 libxcb1 libxext6 \
    && rm -rf /var/lib/apt/lists/*

ENV OMP_NUM_THREADS=2 \
    OPENBLAS_NUM_THREADS=2 \
    MKL_NUM_THREADS=2 \
    ONNXRUNTIME_INTRA_OP_NUM_THREADS=2 \
    ONNXRUNTIME_INTER_OP_NUM_THREADS=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/app/.venv/bin:$PATH"

COPY --from=dependencies /app/.venv /app/.venv
COPY src /app/src

RUN python -c "from rapidocr import RapidOCR; RapidOCR(); print('RapidOCR models verified and baked')"

EXPOSE 8090
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s --retries=5 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/healthz', timeout=2)"]

CMD ["uvicorn", "macros_vision.app:app", "--app-dir", "/app/src", "--host", "0.0.0.0", "--port", "8090", "--workers", "1", "--no-access-log"]
