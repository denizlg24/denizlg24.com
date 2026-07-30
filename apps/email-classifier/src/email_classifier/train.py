"""Leakage-safe grouped cross-validation and final fitting."""

from __future__ import annotations

import json
import sys
import time
from dataclasses import dataclass
from statistics import fmean, pstdev
from typing import Any

import numpy as np
from sklearn.model_selection import StratifiedGroupKFold
from sklearn.multiclass import OneVsRestClassifier
from sklearn.pipeline import Pipeline

from email_classifier.data import Dataset, DatasetError
from email_classifier.evaluate import classification_metrics
from email_classifier.features import build_features
from email_classifier.models import (
    build_classifier,
    build_pipeline,
    candidate_configs,
    fit_classifier,
    fit_pipeline,
)


@dataclass(slots=True)
class TrainedCandidate:
    """A selected configuration, its OOF report, and a full-data model."""

    model_name: str
    config: dict[str, Any]
    pipeline: Pipeline
    metrics: dict[str, Any]
    top_features: dict[str, Any]
    feature_count: int
    training_seconds: float


def _progress(message: str) -> None:
    """Emit concise progress without contaminating JSON stdout."""
    print(f"[train] {message}", file=sys.stderr, flush=True)


def grouped_splits(
    labels: list[str],
    groups: list[str],
    *,
    seed: int,
    preferred_splits: int = 5,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Choose the largest grouped stratified split with every class in each fold."""
    all_labels = set(labels)
    max_splits = min(
        preferred_splits,
        len(set(groups)),
        min(labels.count(label) for label in all_labels),
    )
    indices = np.arange(len(labels))
    for split_count in range(max_splits, 1, -1):
        splitter = StratifiedGroupKFold(
            n_splits=split_count,
            shuffle=True,
            random_state=seed,
        )
        splits = list(splitter.split(indices, labels, groups))
        if all(
            set(np.asarray(labels)[train_indices]) == all_labels
            and set(np.asarray(labels)[valid_indices]) == all_labels
            for train_indices, valid_indices in splits
        ):
            return splits
    raise DatasetError(
        "cannot create at least two grouped folds containing every label; "
        "add independent groups for minority classes"
    )


def local_training_splits(
    dataset: Dataset,
    *,
    seed: int,
    preferred_splits: int = 5,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Hold out only local groups while keeping all synthetic rows in training."""
    local_indices = np.asarray(
        [
            index
            for index, row in enumerate(dataset.rows)
            if row["source"] == "local"
        ],
        dtype=int,
    )
    synthetic_indices = np.asarray(
        [
            index
            for index, row in enumerate(dataset.rows)
            if row["source"] == "synthetic"
        ],
        dtype=int,
    )
    if not len(local_indices):
        raise DatasetError("training data contains no local rows")
    local_labels = [dataset.labels[int(index)] for index in local_indices]
    local_groups = [dataset.groups[int(index)] for index in local_indices]
    local_splits = grouped_splits(
        local_labels,
        local_groups,
        seed=seed,
        preferred_splits=preferred_splits,
    )
    return [
        (
            np.concatenate((local_indices[local_train], synthetic_indices)),
            local_indices[local_valid],
        )
        for local_train, local_valid in local_splits
    ]


def _subset(values: list[Any], indices: np.ndarray) -> list[Any]:
    return [values[int(index)] for index in indices]


def _weighted_subset(
    dataset: Dataset,
    indices: np.ndarray,
    synthetic_multiplier: float,
) -> list[float]:
    return [
        dataset.sample_weights[int(index)]
        * (
            synthetic_multiplier
            if dataset.rows[int(index)]["source"] == "synthetic"
            else 1.0
        )
        for index in indices
    ]


def _search_configs(
    dataset: Dataset,
    model_name: str,
    splits: list[tuple[np.ndarray, np.ndarray]],
    *,
    seed: int,
) -> list[dict[str, Any]]:
    configs = candidate_configs(model_name)
    fold_results: list[list[dict[str, float | int]]] = [
        [] for _ in configs
    ]
    feature_groups: dict[
        tuple[tuple[int, int], tuple[int, int]], list[int]
    ] = {}
    for index, config in enumerate(configs):
        feature_key = (
            tuple(config["word_ngram_range"]),
            tuple(config["char_ngram_range"]),
        )
        feature_groups.setdefault(feature_key, []).append(index)

    for fold, (train_indices, valid_indices) in enumerate(splits, start=1):
        _progress(
            f"fold {fold}/{len(splits)}: "
            f"{len(train_indices)} train, {len(valid_indices)} local validation"
        )
        train_rows = _subset(dataset.inputs, train_indices)
        valid_rows = _subset(dataset.inputs, valid_indices)
        train_labels = _subset(dataset.labels, train_indices)
        valid_labels = _subset(dataset.labels, valid_indices)
        for (word_range, char_range), config_indices in feature_groups.items():
            vectorizer = build_features(
                word_ngram_range=word_range,
                char_ngram_range=char_range,
            )
            vectorize_started = time.perf_counter()
            train_features = vectorizer.fit_transform(train_rows)
            valid_features = vectorizer.transform(valid_rows)
            vectorize_seconds = time.perf_counter() - vectorize_started
            for config_index in config_indices:
                classifier = build_classifier(
                    model_name,
                    configs[config_index],
                    seed=seed,
                )
                fit_started = time.perf_counter()
                fit_classifier(
                    classifier,
                    train_features,
                    train_labels,
                    _weighted_subset(
                        dataset,
                        train_indices,
                        float(
                            configs[config_index][
                                "synthetic_weight_multiplier"
                            ]
                        ),
                    ),
                )
                fit_seconds = time.perf_counter() - fit_started
                predict_started = time.perf_counter()
                predicted = classifier.predict(valid_features)
                predict_seconds = time.perf_counter() - predict_started
                confidences: list[float | None] = [None] * len(valid_indices)
                if hasattr(classifier, "predict_proba"):
                    probabilities = classifier.predict_proba(valid_features)
                    confidences = [
                        float(np.max(row_probabilities))
                        for row_probabilities in probabilities
                    ]
                metrics = classification_metrics(
                    valid_labels,
                    predicted.tolist(),
                )
                fold_results[config_index].append(
                    {
                        "fold": fold,
                        "macro_f1": metrics["macro_f1"],
                        "macro_f1_present": metrics["macro_f1_present"],
                        "accuracy": metrics["accuracy"],
                        "weighted_f1": metrics["weighted_f1"],
                        "vectorize_seconds": vectorize_seconds,
                        "fit_seconds": fit_seconds,
                        "predict_seconds": predict_seconds,
                        "validation_indices": [
                            int(index) for index in valid_indices
                        ],
                        "predictions": [
                            str(value) for value in predicted
                        ],
                        "confidences": confidences,
                    }
                )

    results: list[dict[str, Any]] = []
    for config, config_folds in zip(configs, fold_results, strict=True):
        macro_scores = [
            float(result["macro_f1_present"]) for result in config_folds
        ]
        results.append(
            {
                "config": config,
                "mean_macro_f1_present": fmean(macro_scores),
                "std_macro_f1_present": pstdev(macro_scores),
                "mean_accuracy": fmean(
                    float(result["accuracy"]) for result in config_folds
                ),
                "mean_weighted_f1": fmean(
                    float(result["weighted_f1"]) for result in config_folds
                ),
                "folds": config_folds,
            }
        )
    return results


def _oof_report(
    dataset: Dataset,
    selected_search_result: dict[str, Any],
) -> dict[str, Any]:
    predictions: dict[int, str] = {}
    confidences: dict[int, float | None] = {}
    fit_seconds = sum(
        float(fold["fit_seconds"])
        for fold in selected_search_result["folds"]
    )
    predict_seconds = sum(
        float(fold["predict_seconds"])
        for fold in selected_search_result["folds"]
    )
    for fold in selected_search_result["folds"]:
        for index, predicted, confidence in zip(
            fold["validation_indices"],
            fold["predictions"],
            fold["confidences"],
            strict=True,
        ):
            predictions[int(index)] = str(predicted)
            confidences[int(index)] = confidence
    local_indices = sorted(predictions)
    expected = [dataset.labels[index] for index in local_indices]
    final_predictions = [predictions[index] for index in local_indices]
    metrics = classification_metrics(expected, final_predictions)
    metrics.update(
        {
            "fit_seconds": fit_seconds,
            "predict_seconds": predict_seconds,
            "fold_count": len(selected_search_result["folds"]),
            "validation_source": "local",
            "synthetic_rows_in_every_training_fold": True,
            "predictions": [
                {
                    "id": dataset.rows[index]["id"],
                    "actual": dataset.rows[index]["label"],
                    "predicted": predicted,
                    "correct": dataset.rows[index]["label"] == predicted,
                    "confidence": confidences[index],
                }
                for index, predicted in zip(
                    local_indices,
                    final_predictions,
                    strict=True,
                )
            ],
        }
    )
    return metrics


def explain_features(pipeline: Pipeline, limit: int = 30) -> dict[str, Any]:
    """Extract the strongest per-class linear feature weights."""
    classifier = pipeline.named_steps["classifier"]
    if not hasattr(classifier, "classes_"):
        return {}
    if isinstance(classifier, OneVsRestClassifier):
        weights = np.vstack(
            [np.asarray(estimator.coef_)[0] for estimator in classifier.estimators_]
        )
    elif hasattr(classifier, "coef_"):
        weights = np.asarray(classifier.coef_)
    elif hasattr(classifier, "feature_log_prob_"):
        weights = np.asarray(classifier.feature_log_prob_)
    else:
        return {}
    names = np.asarray(pipeline.named_steps["features"].get_feature_names_out())
    classes = [str(value) for value in classifier.classes_]
    if weights.shape[0] != len(classes):
        return {}
    result: dict[str, Any] = {}
    for class_name, class_weights in zip(classes, weights, strict=True):
        top_indices = np.argsort(class_weights)[-limit:][::-1]
        bottom_indices = np.argsort(class_weights)[:limit]
        result[class_name] = {
            "positive": [
                {"feature": str(names[index]), "weight": float(class_weights[index])}
                for index in top_indices
            ],
            "negative": [
                {"feature": str(names[index]), "weight": float(class_weights[index])}
                for index in bottom_indices
            ],
        }
    return result


def train_candidate(
    dataset: Dataset,
    model_name: str,
    *,
    seed: int = 20260729,
) -> TrainedCandidate:
    """Search training folds, select by macro-F1, and fit all training rows."""
    started = time.perf_counter()
    splits = local_training_splits(dataset, seed=seed)
    configs = candidate_configs(model_name)
    local_count = sum(row["source"] == "local" for row in dataset.rows)
    synthetic_count = len(dataset.rows) - local_count
    _progress(
        f"{model_name}: {len(configs)} configs, {len(splits)} folds, "
        f"{local_count} local + {synthetic_count} synthetic rows"
    )
    search_results = _search_configs(
        dataset,
        model_name,
        splits,
        seed=seed,
    )
    search_results.sort(
        key=lambda result: (
            -float(result["mean_macro_f1_present"]),
            -float(result["mean_weighted_f1"]),
            json.dumps(result["config"], sort_keys=True),
        )
    )
    selected = search_results[0]
    selected_config = dict(selected["config"])
    _progress(
        "selected "
        f"local macro-F1={float(selected['mean_macro_f1_present']):.4f} "
        f"config={json.dumps(selected_config, sort_keys=True)}"
    )
    oof = _oof_report(
        dataset,
        selected,
    )
    _progress("fitting selected configuration on all training rows")
    pipeline = build_pipeline(model_name, selected_config, seed=seed)
    fit_pipeline(
        pipeline,
        dataset.inputs,
        dataset.labels,
        _weighted_subset(
            dataset,
            np.arange(len(dataset.rows)),
            float(selected_config["synthetic_weight_multiplier"]),
        ),
    )
    feature_count = len(
        pipeline.named_steps["features"].get_feature_names_out()
    )
    _progress(
        f"final fit complete: {feature_count} features, "
        f"{time.perf_counter() - started:.1f}s total"
    )
    metrics = {
        "model": model_name,
        "selection_metric": "mean_local_macro_f1_present",
        "selected_config": selected_config,
        "search": search_results,
        "out_of_fold": oof,
    }
    return TrainedCandidate(
        model_name=model_name,
        config=selected_config,
        pipeline=pipeline,
        metrics=metrics,
        top_features=explain_features(pipeline),
        feature_count=feature_count,
        training_seconds=time.perf_counter() - started,
    )
