import re
from collections import Counter
from dataclasses import dataclass
from statistics import median
from threading import Lock

import numpy as np
from rapidocr import RapidOCR


@dataclass(frozen=True)
class OcrText:
    text: str
    confidence: float


class OcrEngine:
    """One process-wide ONNX OCR engine; inference is serialized for bounded RSS."""

    def __init__(self) -> None:
        self._engine = RapidOCR()
        self._lock = Lock()

    def read(self, image: bytes) -> OcrText:
        with self._lock:
            result = self._engine(image)
        texts = list(result.txts or ())
        scores = [float(score) for score in (result.scores or ())]
        confidence = sum(scores) / len(scores) if scores else 0
        boxes = [] if result.boxes is None else list(result.boxes)
        reconstructed = _reconstruct_rows(boxes, texts)
        # Keep the recognizer order for debugging and basis/serving detection,
        # then append geometry-aware rows for nutrition-table interpretation.
        text = "\n".join((*texts, *reconstructed))
        return OcrText(text=text, confidence=confidence)


def _reconstruct_rows(boxes: list[np.ndarray], texts: list[str]) -> list[str]:
    """Deskew OCR boxes and rebuild visually horizontal rows.

    OCR engines commonly return a nutrition table column-by-column. A pure
    newline join therefore separates "Protein" from "15 g" even though they
    share a visual row. The median text-edge slope removes camera rotation,
    after which tokens can be clustered by their corrected vertical centre.
    """
    if len(boxes) != len(texts) or not boxes:
        return []
    heights: list[float] = []
    tokens: list[tuple[float, float, str]] = []
    for box, value in zip(boxes, texts, strict=True):
        points = np.asarray(box, dtype=float)
        heights.append(float(np.max(points[:, 1]) - np.min(points[:, 1])))
        tokens.append((float(np.mean(points[:, 0])), float(np.mean(points[:, 1])), value))
    tolerance = max(2.5, median(heights) * 0.3)
    slope_counts: Counter[float] = Counter()
    for left_x, left_y, left_text in tokens:
        if not re.search(r"[A-Za-zÀ-ÿ]", left_text):
            continue
        for right_x, right_y, right_text in tokens:
            delta_x = right_x - left_x
            if delta_x < tolerance * 5 or not re.search(r"\d", right_text):
                continue
            slope = (right_y - left_y) / delta_x
            if abs(slope) <= 0.3:
                slope_counts[round(slope, 2)] += 1
    candidate_slopes = [slope for slope, _ in slope_counts.most_common() if abs(slope) <= 0.15][:12]
    if 0.0 not in candidate_slopes:
        candidate_slopes.append(0.0)
    output: list[str] = []
    seen: set[str] = set()
    for slope in candidate_slopes:
        for row in _rows_for_slope(tokens, slope, tolerance):
            if row not in seen:
                seen.add(row)
                output.append(row)
    return output


def _rows_for_slope(
    tokens: list[tuple[float, float, str]], slope: float, tolerance: float
) -> list[str]:
    corrected = sorted(
        ((y - slope * x, x, value) for x, y, value in tokens),
        key=lambda token: (token[0], token[1]),
    )
    rows: list[list[tuple[float, float, str]]] = []
    row_centres: list[float] = []
    for y, x, value in corrected:
        nearest = min(
            range(len(rows)),
            key=lambda index: abs(row_centres[index] - y),
            default=None,
        )
        if nearest is None or abs(row_centres[nearest] - y) > tolerance:
            rows.append([(y, x, value)])
            row_centres.append(y)
            continue
        rows[nearest].append((y, x, value))
        row_centres[nearest] = sum(token[0] for token in rows[nearest]) / len(rows[nearest])
    ordered = sorted(zip(row_centres, rows, strict=True), key=lambda item: item[0])
    return [
        " ".join(token[2] for token in sorted(row, key=lambda token: token[1]))
        for _, row in ordered
        if len(row) > 1
    ]
