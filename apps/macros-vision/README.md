# Macros Vision

Private FastAPI service for nutrition-label OCR and lightweight food-photo
classification. It uses RapidOCR with ONNX Runtime and keeps the model resident
in one worker.

```bash
uv sync
MACROS_VISION_API_TOKEN=dev uv run uvicorn macros_vision.app:app --app-dir src --port 8090
uv run pytest
uv run ruff check .
```

`POST /v1/label` and `POST /v1/classify` accept a multipart `image` and require
`Authorization: Bearer <MACROS_VISION_API_TOKEN>`. `/healthz` returns 200 only
after the OCR model is loaded. Uploaded bytes are validated in memory and are
never persisted.

The tracked `eval/` golden set contains attributed Open Food Facts nutrition
images only; user uploads are never added to it. Refresh that set deliberately
with its fetch script and review the source links and checksums. Parser grammar
tests remain in CI, while the model-in-the-loop evaluation runs manually or on
a schedule.
