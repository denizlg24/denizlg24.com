"""Application-owned filesystem locations."""

from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = APP_ROOT / ".data"
DATASET_ROOT = DATA_ROOT / "email-classifier"
TRAIN_PATH = DATASET_ROOT / "train.jsonl"
EVAL_PATH = DATASET_ROOT / "eval.jsonl"
MANIFEST_PATH = DATASET_ROOT / "manifest.json"
RUNS_ROOT = DATASET_ROOT / "runs"
PROTECTED_SENDERS_PATH = DATASET_ROOT / "protected-senders.txt"
