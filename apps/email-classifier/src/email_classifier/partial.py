"""Adapt supported categories while preserving incumbent decisions elsewhere."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from email_classifier.data import LABELS, Dataset, DatasetError
from email_classifier.train import local_training_splits

MIN_CATEGORY_EXAMPLES = 5


def supported_categories(training: Dataset, evaluation: Dataset) -> tuple[str, ...]:
    return tuple(
        label
        for label in LABELS
        if training.distribution[label] >= MIN_CATEGORY_EXAMPLES
        and evaluation.distribution[label] >= MIN_CATEGORY_EXAMPLES
    )


def supported_training(training: Dataset, labels: Sequence[str]) -> Dataset:
    return Dataset(
        training.path, tuple(row for row in training.rows if row["label"] in labels)
    )


def adaptation_plan(
    training: Dataset, evaluation: Dataset
) -> tuple[tuple[str, ...], str | None]:
    labels = supported_categories(training, evaluation)
    if len(labels) < 2:
        return (
            labels,
            "need at least two categories with five training and five fresh "
            "validation examples each",
        )
    try:
        local_training_splits(supported_training(training, labels), seed=20260729)
    except DatasetError:
        return (
            labels,
            "supported categories need more independent training threads "
            "for cross-validation",
        )
    return labels, None


class PartialCategoryClassifier:
    """Gate on the incumbent: an adapter can only change supported decisions.

    Retaining a frozen category's probability mass also keeps the seven-label
    probability contract intact. The adapter redistributes only supported mass.
    Repeated updates of the same label set replace its adapter instead of
    nesting another copy of the complete model every week.
    """

    def __init__(self, incumbent: Any, adapter: Any) -> None:
        self.adapter = adapter
        self.adapted_classes = tuple(
            str(label) for label in adapter.named_steps["classifier"].classes_
        )
        if len(self.adapted_classes) < 2 or not set(self.adapted_classes) <= set(
            LABELS
        ):
            raise ValueError("adapter must support at least two known categories")
        if isinstance(incumbent, PartialCategoryClassifier) and set(
            incumbent.adapted_classes
        ) == set(self.adapted_classes):
            incumbent = incumbent.incumbent
        self.incumbent = incumbent
        self.classes_ = np.array(LABELS)
        self.incumbent_classes = tuple(
            str(label) for label in incumbent.named_steps["classifier"].classes_
        )
        if set(self.incumbent_classes) != set(LABELS):
            raise ValueError("incumbent must preserve all seven categories")

    @property
    def named_steps(self) -> dict[str, Any]:
        return {"classifier": self}

    def predict(self, rows: Sequence[dict[str, Any]]) -> np.ndarray:
        predictions = np.asarray(self.incumbent.predict(rows), dtype=object).copy()
        indices = [
            i for i, label in enumerate(predictions) if label in self.adapted_classes
        ]
        if indices:
            updated = self.adapter.predict([rows[i] for i in indices])
            if not set(updated) <= set(self.adapted_classes):
                raise ValueError("adapter returned an unsupported category")
            predictions[indices] = updated
        return predictions

    def predict_proba(self, rows: Sequence[dict[str, Any]]) -> np.ndarray:
        raw = np.asarray(self.incumbent.predict_proba(rows), dtype=float)
        result = raw[
            :, [self.incumbent_classes.index(label) for label in LABELS]
        ].copy()
        predictions = self.incumbent.predict(rows)
        indices = [
            i for i, label in enumerate(predictions) if label in self.adapted_classes
        ]
        if indices:
            probabilities = np.asarray(
                self.adapter.predict_proba([rows[i] for i in indices]), dtype=float
            )
            totals = probabilities.sum(axis=1)
            if (
                not np.isfinite(probabilities).all()
                or (probabilities < 0).any()
                or (totals <= 0).any()
            ):
                raise ValueError("adapter returned invalid probabilities")
            columns = [LABELS.index(label) for label in self.adapted_classes]
            mass = result[np.ix_(indices, columns)].sum(axis=1)
            result[np.ix_(indices, columns)] = (
                probabilities / totals[:, None] * mass[:, None]
            )
        return result
