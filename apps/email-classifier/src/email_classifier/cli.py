"""Command-line interface for validation, training, evaluation, and inference."""

from __future__ import annotations

import argparse
import csv
import importlib.metadata
import json
import os
import subprocess
import sys
import time
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import joblib

from email_classifier import __version__
from email_classifier.data import (
    LABELS,
    DatasetError,
    file_sha256,
    load_datasets,
    load_jsonl,
    prepare_inference_row,
)
from email_classifier.evaluate import classification_metrics
from email_classifier.models import MODEL_NAMES
from email_classifier.paths import (
    APP_ROOT,
    EVAL_PATH,
    MANIFEST_PATH,
    PROTECTED_SENDERS_PATH,
    RUNS_ROOT,
    TRAIN_PATH,
)
from email_classifier.policy import apply_policy, load_protected_senders
from email_classifier.train import TrainedCandidate, train_candidate

SEED = 20260729


def _add_dataset_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--train", type=Path, default=TRAIN_PATH)
    parser.add_argument("--eval", type=Path, default=EVAL_PATH)
    parser.add_argument("--manifest", type=Path, default=MANIFEST_PATH)


def build_parser() -> argparse.ArgumentParser:
    """Create the CLI parser."""
    parser = argparse.ArgumentParser(prog="email-classifier")
    parser.add_argument("--version", action="version", version=__version__)
    commands = parser.add_subparsers(dest="command", required=True)

    validate_parser = commands.add_parser(
        "validate", help="validate prepared train/eval data"
    )
    _add_dataset_arguments(validate_parser)

    train_parser = commands.add_parser(
        "train", help="cross-validate and train one classical candidate"
    )
    _add_dataset_arguments(train_parser)
    train_parser.add_argument(
        "--model",
        choices=MODEL_NAMES,
        default="logistic-regression",
    )
    train_parser.add_argument("--seed", type=int, default=SEED)
    train_parser.add_argument("--runs-dir", type=Path, default=RUNS_ROOT)

    compare_parser = commands.add_parser(
        "compare", help="compare candidates on training folds only"
    )
    _add_dataset_arguments(compare_parser)
    compare_parser.add_argument("--seed", type=int, default=SEED)
    compare_parser.add_argument("--runs-dir", type=Path, default=RUNS_ROOT)

    evaluate_parser = commands.add_parser(
        "evaluate", help="evaluate a locked run once on the final holdout"
    )
    evaluate_parser.add_argument("--run", type=Path, required=True)
    evaluate_parser.add_argument("--eval", type=Path)

    predict_parser = commands.add_parser(
        "predict", help="classify one JSON email or a JSONL batch"
    )
    predict_parser.add_argument("--model", type=Path, required=True)
    predict_parser.add_argument("--input", required=True)
    predict_parser.add_argument("--output", type=Path)
    predict_parser.add_argument(
        "--protected-senders",
        type=Path,
        default=PROTECTED_SENDERS_PATH,
    )
    return parser


def _write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    os.replace(temporary, path)


def _write_jsonl(path: Path, rows: Sequence[dict[str, Any]]) -> None:
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")))
            handle.write("\n")
    os.replace(temporary, path)


def _git_commit() -> str | None:
    completed = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=APP_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    return completed.stdout.strip() if completed.returncode == 0 else None


def _dependency_versions() -> dict[str, str]:
    names = ("joblib", "numpy", "scikit-learn")
    return {name: importlib.metadata.version(name) for name in names}


def _new_run_dir(root: Path, suffix: str) -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    path = root / f"{timestamp}-{suffix}"
    path.mkdir(parents=True, exist_ok=False)
    return path


def _dataset_metadata(bundle: Any) -> dict[str, Any]:
    return {
        "train": {
            "path": str(bundle.train.path),
            "sha256": file_sha256(bundle.train.path),
            "rows": len(bundle.train.rows),
            "labels": bundle.train.distribution,
            "sources": dict(
                sorted(Counter(row["source"] for row in bundle.train.rows).items())
            ),
        },
        "eval": {
            "path": str(bundle.eval.path),
            "sha256": file_sha256(bundle.eval.path),
            "rows": len(bundle.eval.rows),
            "labels": bundle.eval.distribution,
            "sources": dict(
                sorted(Counter(row["source"] for row in bundle.eval.rows).items())
            ),
        },
        "manifest": {
            "path": str(bundle.manifest_path),
            "sha256": file_sha256(bundle.manifest_path),
        },
    }


def command_validate(args: argparse.Namespace) -> int:
    bundle = load_datasets(args.train, args.eval, args.manifest)
    print(
        json.dumps(
            {
                "valid": True,
                "train": {
                    "rows": len(bundle.train.rows),
                    "labels": bundle.train.distribution,
                },
                "eval": {
                    "rows": len(bundle.eval.rows),
                    "labels": bundle.eval.distribution,
                },
                "manifest": str(bundle.manifest_path),
            },
            indent=2,
        )
    )
    return 0


def _save_trained_run(
    run_dir: Path,
    trained: TrainedCandidate,
    bundle: Any,
    *,
    seed: int,
) -> None:
    dataset_metadata = _dataset_metadata(bundle)
    config = {
        "model": trained.model_name,
        "seed": seed,
        "parameters": trained.config,
        "dataset": dataset_metadata,
    }
    _write_json(run_dir / "config.json", config)
    _write_json(run_dir / "data-manifest.json", bundle.manifest)
    _write_json(run_dir / "metrics-cv.json", trained.metrics)
    _write_json(run_dir / "top-features.json", trained.top_features)
    model_path = run_dir / "model.joblib"
    joblib.dump(trained.pipeline, model_path)
    _write_json(
        run_dir / "run.json",
        {
            "schema_version": 1,
            "status": "trained",
            "created_at": datetime.now(UTC).isoformat(),
            "model": trained.model_name,
            "seed": seed,
            "feature_count": trained.feature_count,
            "training_seconds": trained.training_seconds,
            "artifact_bytes": model_path.stat().st_size,
            "python": sys.version,
            "dependencies": _dependency_versions(),
            "git_commit": _git_commit(),
            "command": sys.argv,
            "dataset": dataset_metadata,
        },
    )


def command_train(args: argparse.Namespace) -> int:
    bundle = load_datasets(args.train, args.eval, args.manifest)
    trained = train_candidate(bundle.train, args.model, seed=args.seed)
    run_dir = _new_run_dir(args.runs_dir, args.model)
    _save_trained_run(run_dir, trained, bundle, seed=args.seed)
    print(f"[train] saved run to {run_dir.resolve()}", file=sys.stderr, flush=True)
    print(
        json.dumps(
            {
                "run": str(run_dir.resolve()),
                "model": args.model,
                "selected_config": trained.config,
                "local_macro_f1_oof": trained.metrics["out_of_fold"][
                    "macro_f1_present"
                ],
                "feature_count": trained.feature_count,
            },
            indent=2,
        )
    )
    return 0


def command_compare(args: argparse.Namespace) -> int:
    bundle = load_datasets(args.train, args.eval, args.manifest)
    run_dir = _new_run_dir(args.runs_dir, "compare")
    results: list[dict[str, Any]] = []
    for model_name in MODEL_NAMES:
        trained = train_candidate(bundle.train, model_name, seed=args.seed)
        results.append(
            {
                "model": model_name,
                "selected_config": trained.config,
                "local_macro_f1_oof": trained.metrics["out_of_fold"][
                    "macro_f1_present"
                ],
                "accuracy_oof": trained.metrics["out_of_fold"]["accuracy"],
                "weighted_f1_oof": trained.metrics["out_of_fold"]["weighted_f1"],
                "feature_count": trained.feature_count,
                "training_seconds": trained.training_seconds,
            }
        )
    results.sort(key=lambda result: -float(result["local_macro_f1_oof"]))
    _write_json(run_dir / "comparison.json", {"seed": args.seed, "results": results})
    _write_json(run_dir / "data-manifest.json", bundle.manifest)
    _write_json(
        run_dir / "run.json",
        {
            "schema_version": 1,
            "status": "compared",
            "created_at": datetime.now(UTC).isoformat(),
            "seed": args.seed,
            "python": sys.version,
            "dependencies": _dependency_versions(),
            "git_commit": _git_commit(),
            "command": sys.argv,
            "dataset": _dataset_metadata(bundle),
        },
    )
    print(json.dumps({"run": str(run_dir.resolve()), "results": results}, indent=2))
    return 0


def _probability_rows(
    model: Any, rows: list[dict[str, Any]]
) -> list[dict[str, float] | None]:
    if not hasattr(model, "predict_proba"):
        return [None] * len(rows)
    probabilities = model.predict_proba(rows)
    classifier = model.named_steps["classifier"]
    classes = [str(value) for value in classifier.classes_]
    return [
        {
            label: float(probability)
            for label, probability in zip(classes, row, strict=True)
        }
        for row in probabilities
    ]


def _write_confusion_csv(path: Path, matrix: list[list[int]]) -> None:
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["actual/predicted", *LABELS])
        for label, row in zip(LABELS, matrix, strict=True):
            writer.writerow([label, *row])


def command_evaluate(args: argparse.Namespace) -> int:
    run_dir = args.run.resolve()
    metrics_path = run_dir / "metrics-eval.json"
    if metrics_path.exists():
        raise ValueError(
            f"{metrics_path} already exists; create a new locked run to re-evaluate"
        )
    config = json.loads((run_dir / "config.json").read_text(encoding="utf-8"))
    eval_path = (args.eval or Path(config["dataset"]["eval"]["path"])).resolve()
    expected_hash = config["dataset"]["eval"]["sha256"]
    actual_hash = file_sha256(eval_path)
    if actual_hash != expected_hash:
        raise DatasetError(
            "evaluation dataset hash differs from the locked training run"
        )
    evaluation = load_jsonl(eval_path, split="eval")
    model = joblib.load(run_dir / "model.joblib")
    started = time.perf_counter()
    predicted = [str(value) for value in model.predict(evaluation.inputs)]
    prediction_seconds = time.perf_counter() - started
    probability_rows = _probability_rows(model, evaluation.inputs)
    metrics = classification_metrics(evaluation.labels, predicted)
    metrics["prediction_seconds"] = prediction_seconds
    predictions = []
    for row, label, probabilities in zip(
        evaluation.rows, predicted, probability_rows, strict=True
    ):
        confidence = max(probabilities.values()) if probabilities else None
        predictions.append(
            {
                "id": row["id"],
                "actual": row["label"],
                "predicted": label,
                "correct": row["label"] == label,
                "confidence": confidence,
                "probabilities": probabilities,
            }
        )
    _write_json(metrics_path, metrics)
    _write_jsonl(run_dir / "predictions-eval.jsonl", predictions)
    _write_confusion_csv(
        run_dir / "confusion-matrix.csv", metrics["confusion_matrix"]
    )
    run_metadata_path = run_dir / "run.json"
    run_metadata = json.loads(run_metadata_path.read_text(encoding="utf-8"))
    run_metadata.update(
        {
            "status": "evaluated",
            "evaluated_at": datetime.now(UTC).isoformat(),
            "evaluation_seconds": prediction_seconds,
        }
    )
    _write_json(run_metadata_path, run_metadata)
    print(
        json.dumps(
            {
                "run": str(run_dir),
                "macro_f1": metrics["macro_f1"],
                "accuracy": metrics["accuracy"],
                "spam_counts": metrics["spam_counts"],
            },
            indent=2,
        )
    )
    return 0


def _read_prediction_input(value: str) -> list[dict[str, Any]]:
    if value == "-":
        content = sys.stdin.read()
        source = "<stdin>"
        suffix = ""
    else:
        path = Path(value)
        content = path.read_text(encoding="utf-8")
        source = str(path)
        suffix = path.suffix.casefold()
    try:
        if suffix == ".jsonl":
            rows = [
                json.loads(line)
                for line in content.splitlines()
                if line.strip()
            ]
        else:
            parsed = json.loads(content)
            rows = parsed if isinstance(parsed, list) else [parsed]
    except json.JSONDecodeError as exc:
        raise ValueError(f"{source}: invalid JSON: {exc}") from exc
    if not rows or not all(isinstance(row, dict) for row in rows):
        raise ValueError(f"{source}: expected a JSON object or non-empty object array")
    return rows


def command_predict(args: argparse.Namespace) -> int:
    model = joblib.load(args.model)
    inputs = _read_prediction_input(args.input)
    model_rows = [prepare_inference_row(row) for row in inputs]
    model_labels = [str(value) for value in model.predict(model_rows)]
    probability_rows = _probability_rows(model, model_rows)
    protected_senders = load_protected_senders(args.protected_senders)
    outputs = []
    for index, (row, model_label, probabilities) in enumerate(
        zip(model_rows, model_labels, probability_rows, strict=True)
    ):
        sender_address = str(
            row.get("sender_address")
            or row.get("senderAddress")
            or row.get("fromAddress")
            or ""
        )
        label, policy_reason = apply_policy(
            model_label, sender_address, protected_senders
        )
        outputs.append(
            {
                "id": row.get("id", index),
                "label": label,
                "model_label": model_label,
                "confidence": max(probabilities.values()) if probabilities else None,
                "probabilities": probabilities,
                "policy_reason": policy_reason,
            }
        )
    if args.output:
        _write_jsonl(args.output, outputs)
        print(f"Wrote {len(outputs)} predictions to {args.output}")
    else:
        for output in outputs:
            print(json.dumps(output, ensure_ascii=False))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the command-line application."""
    args = build_parser().parse_args(argv)
    handlers = {
        "validate": command_validate,
        "train": command_train,
        "compare": command_compare,
        "evaluate": command_evaluate,
        "predict": command_predict,
    }
    try:
        return handlers[args.command](args)
    except (DatasetError, OSError, ValueError, KeyError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
