"""Metrics and prediction-report helpers."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sklearn.metrics import (
    accuracy_score,
    classification_report,
    confusion_matrix,
    f1_score,
)

from email_classifier.data import LABELS


def classification_metrics(
    expected: Sequence[str],
    predicted: Sequence[str],
) -> dict[str, Any]:
    """Compute stable metrics with every target label represented."""
    report = classification_report(
        expected,
        predicted,
        labels=LABELS,
        target_names=LABELS,
        output_dict=True,
        zero_division=0,
    )
    matrix = confusion_matrix(expected, predicted, labels=LABELS)
    present_labels = [
        label for label in LABELS if label in set(expected)
    ]
    spam_index = LABELS.index("spam")
    spam_true_positive = int(matrix[spam_index, spam_index])
    spam_false_negative = int(matrix[spam_index, :].sum() - spam_true_positive)
    spam_false_positive = int(matrix[:, spam_index].sum() - spam_true_positive)
    return {
        "accuracy": float(accuracy_score(expected, predicted)),
        "macro_f1": float(
            f1_score(
                expected,
                predicted,
                labels=LABELS,
                average="macro",
                zero_division=0,
            )
        ),
        "macro_f1_present": float(
            f1_score(
                expected,
                predicted,
                labels=present_labels,
                average="macro",
                zero_division=0,
            )
        ),
        "weighted_f1": float(
            f1_score(
                expected,
                predicted,
                labels=LABELS,
                average="weighted",
                zero_division=0,
            )
        ),
        "per_class": {label: report[label] for label in LABELS},
        "confusion_matrix": matrix.tolist(),
        "labels": list(LABELS),
        "spam_counts": {
            "true_positive": spam_true_positive,
            "false_positive": spam_false_positive,
            "false_negative": spam_false_negative,
            "actual": int(matrix[spam_index, :].sum()),
            "predicted": int(matrix[:, spam_index].sum()),
        },
    }
