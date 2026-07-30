"""Model definitions and intentionally small search spaces."""

from __future__ import annotations

from itertools import product
from typing import Any

import numpy as np
from sklearn import config_context
from sklearn.base import BaseEstimator, ClassifierMixin
from sklearn.dummy import DummyClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.multiclass import OneVsRestClassifier
from sklearn.naive_bayes import ComplementNB
from sklearn.pipeline import Pipeline
from sklearn.svm import LinearSVC

from email_classifier.data import LABELS
from email_classifier.features import build_features

MODEL_NAMES = (
    "logistic-regression",
    "linear-svc",
    "hierarchical-linear-svc",
    "complement-nb",
    "dummy",
)
SYNTHETIC_WEIGHT_MULTIPLIERS = (0.5, 1.0)
LABEL_BUCKETS = {
    "spam": "bulk",
    "newsletter": "bulk",
    "promo": "bulk",
    "purchases": "transactional",
    "fyi": "personal",
    "action-needed": "personal",
    "scheduled": "personal",
}


class HierarchicalLinearSVC(ClassifierMixin, BaseEstimator):
    """Classify broad mail intent before resolving the final label."""

    def __init__(
        self,
        C: float = 1.0,
        class_weight: str | None = None,
        random_state: int | None = None,
    ) -> None:
        self.C = C
        self.class_weight = class_weight
        self.random_state = random_state

    def _new_classifier(self) -> LinearSVC:
        return LinearSVC(
            C=self.C,
            class_weight=self.class_weight,
            max_iter=10_000,
            random_state=self.random_state,
            tol=1e-3,
        )

    def fit(
        self,
        features: Any,
        labels: list[str],
        sample_weight: list[float] | None = None,
    ) -> HierarchicalLinearSVC:
        label_array = np.asarray(labels, dtype=object)
        bucket_labels = np.asarray(
            [LABEL_BUCKETS[str(label)] for label in label_array],
            dtype=object,
        )
        weights = (
            np.asarray(sample_weight, dtype=float)
            if sample_weight is not None
            else None
        )
        self.bucket_classifier_ = self._new_classifier()
        self.bucket_classifier_.fit(
            features,
            bucket_labels,
            sample_weight=weights,
        )
        self.label_classifiers_: dict[str, LinearSVC] = {}
        self.fixed_labels_: dict[str, str] = {}
        for bucket in sorted(set(bucket_labels)):
            indices = np.flatnonzero(bucket_labels == bucket)
            bucket_targets = label_array[indices]
            unique_targets = sorted(set(str(value) for value in bucket_targets))
            if len(unique_targets) == 1:
                self.fixed_labels_[str(bucket)] = unique_targets[0]
                continue
            classifier = self._new_classifier()
            classifier.fit(
                features[indices],
                bucket_targets,
                sample_weight=weights[indices] if weights is not None else None,
            )
            self.label_classifiers_[str(bucket)] = classifier
        self.classes_ = np.asarray(LABELS, dtype=object)
        return self

    def predict(self, features: Any) -> np.ndarray:
        buckets = self.bucket_classifier_.predict(features)
        predictions = np.empty(len(buckets), dtype=object)
        for bucket in sorted(set(str(value) for value in buckets)):
            indices = np.flatnonzero(buckets == bucket)
            if bucket in self.fixed_labels_:
                predictions[indices] = self.fixed_labels_[bucket]
            else:
                predictions[indices] = self.label_classifiers_[bucket].predict(
                    features[indices]
                )
        return predictions


def candidate_configs(model_name: str) -> list[dict[str, Any]]:
    """Return the bounded hyperparameter space from the training plan."""
    if model_name not in MODEL_NAMES:
        raise ValueError(f"unknown model {model_name!r}")
    if model_name == "dummy":
        return [
            {
                "word_ngram_range": (1, 2),
                "char_ngram_range": (3, 5),
                "strategy": "prior",
                "synthetic_weight_multiplier": 1.0,
            }
        ]

    # Field-aware vectorization is substantially larger than the original
    # canonical-text matrix. Keep the ranges selected by the strongest prior
    # SVC run fixed and search classifier/weight parameters by default.
    feature_options = (((1, 2), (3, 5)),)
    configs: list[dict[str, Any]] = []
    for word_range, char_range in feature_options:
        base = {
            "word_ngram_range": word_range,
            "char_ngram_range": char_range,
        }
        if model_name == "logistic-regression":
            for c_value, class_weight, synthetic_multiplier in product(
                (0.25, 1.0, 4.0),
                (None, "balanced"),
                SYNTHETIC_WEIGHT_MULTIPLIERS,
            ):
                configs.append(
                    {
                        **base,
                        "C": c_value,
                        "class_weight": class_weight,
                        "synthetic_weight_multiplier": synthetic_multiplier,
                    }
                )
        elif model_name in {"linear-svc", "hierarchical-linear-svc"}:
            for c_value, synthetic_multiplier, class_weight in product(
                (0.25, 1.0, 4.0),
                SYNTHETIC_WEIGHT_MULTIPLIERS,
                (None, "balanced"),
            ):
                configs.append(
                    {
                        **base,
                        "C": c_value,
                        "class_weight": class_weight,
                        "synthetic_weight_multiplier": synthetic_multiplier,
                    }
                )
        else:
            for alpha, synthetic_multiplier in product(
                (0.25, 0.5, 1.0),
                SYNTHETIC_WEIGHT_MULTIPLIERS,
            ):
                configs.append(
                    {
                        **base,
                        "alpha": alpha,
                        "synthetic_weight_multiplier": synthetic_multiplier,
                    }
                )
    return configs


def build_classifier(
    model_name: str,
    config: dict[str, Any],
    *,
    seed: int,
) -> ClassifierMixin:
    if model_name == "logistic-regression":
        base_classifier = LogisticRegression(
            C=float(config["C"]),
            class_weight=config.get("class_weight"),
            max_iter=2000,
            random_state=seed,
            solver="liblinear",
        )
        with config_context(enable_metadata_routing=True):
            base_classifier.set_fit_request(sample_weight=True)
        return OneVsRestClassifier(base_classifier, n_jobs=1)
    if model_name == "linear-svc":
        return LinearSVC(
            C=float(config["C"]),
            class_weight=config.get("class_weight"),
            max_iter=10_000,
            random_state=seed,
            tol=1e-3,
        )
    if model_name == "hierarchical-linear-svc":
        return HierarchicalLinearSVC(
            C=float(config["C"]),
            class_weight=config.get("class_weight"),
            random_state=seed,
        )
    if model_name == "complement-nb":
        return ComplementNB(alpha=float(config["alpha"]))
    if model_name == "dummy":
        return DummyClassifier(strategy=str(config["strategy"]), random_state=seed)
    raise ValueError(f"unknown model {model_name!r}")


def build_pipeline(
    model_name: str,
    config: dict[str, Any],
    *,
    seed: int,
    min_df: int = 2,
) -> Pipeline:
    """Build one complete TF-IDF/classifier pipeline."""
    features = build_features(
        word_ngram_range=tuple(config["word_ngram_range"]),
        char_ngram_range=tuple(config["char_ngram_range"]),
        min_df=min_df,
    )
    return Pipeline(
        [
            ("features", features),
            ("classifier", build_classifier(model_name, config, seed=seed)),
        ]
    )


def fit_classifier(
    classifier: ClassifierMixin,
    features: Any,
    labels: list[str],
    sample_weights: list[float],
) -> ClassifierMixin:
    """Fit an estimator with explicit sample-weight routing."""
    if isinstance(classifier, OneVsRestClassifier):
        with config_context(enable_metadata_routing=True):
            classifier.fit(features, labels, sample_weight=sample_weights)
    else:
        classifier.fit(features, labels, sample_weight=sample_weights)
    return classifier


def fit_pipeline(
    pipeline: Pipeline,
    rows: list[dict[str, Any]],
    labels: list[str],
    sample_weights: list[float],
) -> Pipeline:
    """Fit a pipeline while explicitly forwarding per-row weights."""
    if isinstance(pipeline.named_steps["classifier"], OneVsRestClassifier):
        with config_context(enable_metadata_routing=True):
            pipeline.fit(rows, labels, sample_weight=sample_weights)
    else:
        pipeline.fit(
            rows,
            labels,
            classifier__sample_weight=sample_weights,
        )
    return pipeline
