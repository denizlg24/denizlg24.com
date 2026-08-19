import numpy as np

from macros_vision.ocr import _reconstruct_rows


def box(left: float, top: float, right: float, bottom: float) -> np.ndarray:
    return np.array([[left, top], [right, top], [right, bottom], [left, bottom]], dtype=float)


def test_reconstructs_a_perspective_skewed_table_row() -> None:
    boxes = [
        box(10, 40, 65, 52),
        box(110, 28, 175, 40),
        box(10, 60, 45, 72),
        box(110, 48, 145, 60),
    ]
    rows = _reconstruct_rows(boxes, ["Energy", "840kJ/200kcal", "Fat", "10g"])

    assert "Energy 840kJ/200kcal" in rows
    assert "Fat 10g" in rows
