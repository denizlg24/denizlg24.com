import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))

from macros_vision.ocr import OcrEngine
from macros_vision.parser import parse_label_text

ROOT = Path(__file__).parent


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text())
    engine = OcrEngine()
    field_total = 0
    field_correct = 0
    basis_correct = 0
    failures: list[dict[str, object]] = []
    formats: dict[str, dict[str, int]] = {}
    for fixture in manifest:
        image = ROOT / fixture["file"]
        content = image.read_bytes()
        if hashlib.sha256(content).hexdigest() != fixture["sha256"]:
            raise RuntimeError(f"Checksum mismatch: {image}")
        ocr = engine.read(content)
        parsed = parse_label_text(ocr.text, ocr.confidence)
        expected_basis = fixture["expected"]["basis"]
        basis_match = parsed.basis == expected_basis
        basis_correct += basis_match
        format_metrics = formats.setdefault(
            expected_basis,
            {"fixtures": 0, "basisCorrect": 0, "fields": 0, "fieldsCorrect": 0},
        )
        format_metrics["fixtures"] += 1
        format_metrics["basisCorrect"] += basis_match
        field_failures: list[dict[str, object]] = []
        for key, expected in fixture["expected"]["fields"].items():
            field_total += 1
            actual = parsed.fields.get(key)
            tolerance = max(0.5, abs(expected) * 0.08)
            correct = (
                actual is not None
                and actual.value is not None
                and abs(actual.value - expected) <= tolerance
            )
            field_correct += correct
            format_metrics["fields"] += 1
            format_metrics["fieldsCorrect"] += correct
            if not correct:
                field_failures.append(
                    {
                        "field": key,
                        "expected": expected,
                        "actual": actual.value if actual else None,
                    }
                )
        if field_failures:
            failures.append(
                {
                    "file": fixture["file"],
                    "fields": field_failures,
                    "rawText": parsed.raw_text,
                }
            )
    by_format = {
        key: {
            "fixtures": value["fixtures"],
            "basisAccuracy": value["basisCorrect"] / value["fixtures"],
            "fieldAccuracy": value["fieldsCorrect"] / value["fields"],
            "fieldsScored": value["fields"],
        }
        for key, value in formats.items()
    }
    report = {
        "fixtures": len(manifest),
        "basisAccuracy": basis_correct / len(manifest),
        "fieldAccuracy": field_correct / field_total,
        "fieldsScored": field_total,
        "byFormat": by_format,
        "failures": failures,
    }
    (ROOT / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "failures"}, indent=2))


if __name__ == "__main__":
    main()
