import asyncio
import hmac
import io
import os
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError

from .models import Candidate, ClassifyResponse, LabelResponse
from .ocr import OcrEngine
from .parser import parse_label_text

MAX_IMAGE_BYTES = int(os.getenv("MACROS_VISION_MAX_IMAGE_BYTES", "5242880"))
MAX_IMAGE_DIMENSION = int(os.getenv("MACROS_VISION_MAX_IMAGE_DIMENSION", "4096"))
PROCESSING_TIMEOUT_SECONDS = float(os.getenv("MACROS_VISION_TIMEOUT_SECONDS", "15"))


class State:
    engine: OcrEngine | None = None
    ready = False


state = State()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    state.engine = await asyncio.to_thread(OcrEngine)
    state.ready = True
    yield
    state.ready = False
    state.engine = None


app = FastAPI(title="Macros Vision", version="1.0.0", lifespan=lifespan)


def authorize(authorization: Annotated[str | None, Header()] = None) -> None:
    expected = os.getenv("MACROS_VISION_API_TOKEN", "")
    supplied = authorization.removeprefix("Bearer ") if authorization else ""
    if not expected or not hmac.compare_digest(supplied, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


async def read_image(upload: UploadFile) -> bytes:
    if upload.content_type not in {"image/jpeg", "image/png", "image/webp", "image/heic"}:
        raise HTTPException(status_code=415, detail="Unsupported image type")
    image = await upload.read(MAX_IMAGE_BYTES + 1)
    if len(image) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="Image is too large")
    try:
        with Image.open(io.BytesIO(image)) as decoded:
            width, height = decoded.size
            decoded.verify()
    except (UnidentifiedImageError, OSError) as error:
        raise HTTPException(status_code=400, detail="Invalid image") from error
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise HTTPException(status_code=413, detail="Image dimensions are too large")
    return image


async def run_ocr(image: bytes):
    if not state.ready or state.engine is None:
        raise HTTPException(status_code=503, detail="OCR model is not ready")
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(state.engine.read, image),
            timeout=PROCESSING_TIMEOUT_SECONDS,
        )
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail="OCR processing timed out") from error


@app.get("/healthz")
def health() -> dict[str, str]:
    if not state.ready or state.engine is None:
        raise HTTPException(status_code=503, detail="OCR model is loading")
    return {"status": "ready"}


@app.post("/v1/label", response_model=LabelResponse, response_model_by_alias=True)
async def parse_label(
    image: Annotated[UploadFile, File()],
    _authorized: Annotated[None, Depends(authorize)],
    label_format: Annotated[Literal["eu", "us"] | None, Form(alias="labelFormat")] = None,
) -> LabelResponse:
    result = await run_ocr(await read_image(image))
    return parse_label_text(result.text, result.confidence, label_format)


@app.post("/v1/classify", response_model=ClassifyResponse, response_model_by_alias=True)
async def classify_food(
    image: Annotated[UploadFile, File()],
    _authorized: Annotated[None, Depends(authorize)],
) -> ClassifyResponse:
    result = await run_ocr(await read_image(image))
    candidates: list[Candidate] = []
    seen: set[str] = set()
    for line in result.text.splitlines():
        candidate = " ".join(line.split()).strip(" -:·")
        if len(candidate) < 3 or any(char.isdigit() for char in candidate):
            continue
        key = candidate.casefold()
        if key in seen:
            continue
        seen.add(key)
        candidates.append(Candidate(name=candidate[:120], confidence=result.confidence))
        if len(candidates) == 5:
            break
    return ClassifyResponse(candidates=candidates, raw_text=result.text)
