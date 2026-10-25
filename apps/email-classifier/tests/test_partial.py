from __future__ import annotations

import copy
import hashlib
from types import SimpleNamespace
from unittest.mock import patch

import joblib
import numpy as np
import pytest
from test_retrain import MemoryStore, recovery_rows, row

from email_classifier import retrain, runtime, train
from email_classifier.artifacts import write_json
from email_classifier.data import LABELS, Dataset, DatasetError, load_datasets
from email_classifier.models import candidate_configs
from email_classifier.partial import (
    PartialCategoryClassifier,
    adaptation_plan,
    supported_categories,
)
from email_classifier.recovery import seed_dataset


class LabelModel:
    def __init__(self, labels=LABELS, field="base_label"):
        self.classes = tuple(labels)
        self.field = field
        self.named_steps = {"classifier": SimpleNamespace(classes_=np.array(labels))}

    def predict(self, rows):
        return np.array([r[self.field] for r in rows])

    def predict_proba(self, rows):
        return np.array(
            [
                [
                    0.7 if label == r[self.field] else 0.3 / (len(self.classes) - 1)
                    for label in self.classes
                ]
                for r in rows
            ]
        )


def partial_rows():
    # Deliberately omit spam entirely; include scarce newsletters in training.
    examples = [r for r in recovery_rows() if r["label"] in {"fyi", "purchases"}]
    examples.append(
        {
            **row("rare-newsletter", "newsletter"),
            "received_at": "2020-01-01T00:00:00+00:00",
            "ingested_at": "2020-01-01T00:00:00+00:00",
        }
    )
    return examples


def test_recovery_proceeds_without_any_spam_or_rare_category_validation(tmp_path):
    write_json(tmp_path / "recovery.json", {"started_at": "2030-01-01T00:00:00+00:00"})
    report = {}
    bundle = seed_dataset(tmp_path, partial_rows(), report)
    assert bundle is not None
    assert report["recovery"]["adaptable_categories"] == ["purchases", "fyi"]
    assert "spam" in report["recovery"]["frozen_categories"]
    assert bundle.train.distribution["spam"] == 0
    assert bundle.train.distribution["newsletter"] == 1
    assert supported_categories(bundle.train, bundle.eval) == ("purchases", "fyi")
    # CLI callers remain strict unless they explicitly opt into partial data.
    with pytest.raises(DatasetError, match="missing labels"):
        load_datasets(
            tmp_path / "seed/train.jsonl",
            tmp_path / "seed/eval.jsonl",
            tmp_path / "seed/manifest.json",
        )
    assert seed_dataset(tmp_path, [], {}).eval.rows == bundle.eval.rows


def test_one_supported_category_still_waits_for_a_meaningful_comparison(tmp_path):
    examples = tuple(row(f"fyi-{i}") for i in range(6))
    labels, reason = adaptation_plan(
        Dataset(tmp_path, examples), Dataset(tmp_path, examples)
    )
    assert labels == ("fyi",)
    assert "at least two" in reason


def test_adapter_preserves_all_frozen_decisions_and_probability_mass(tmp_path):
    base = LabelModel(tuple(reversed(LABELS)))
    adapter = LabelModel(("fyi", "purchases"), "adapted_label")
    model = PartialCategoryClassifier(base, adapter)
    examples = [
        {**row(label), "base_label": label, "adapted_label": "purchases"}
        for label in LABELS
    ]
    predictions = model.predict(examples)
    old = base.predict_proba(examples)[
        :, [base.classes.index(label) for label in LABELS]
    ]
    new = model.predict_proba(examples)
    for index, label in enumerate(LABELS):
        if label not in adapter.classes:
            assert predictions[index] == label
            assert np.array_equal(old[index], new[index])
        else:
            assert predictions[index] == "purchases"
    for label in LABELS:
        if label not in adapter.classes:
            assert np.array_equal(
                old[:, LABELS.index(label)], new[:, LABELS.index(label)]
            )
    assert np.allclose(new.sum(axis=1), 1.0)
    path = tmp_path / "model.joblib"
    joblib.dump(model, path)
    loaded = joblib.load(path)
    assert list(loaded.predict(examples)) == list(predictions)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    # Exercise the production loader and its seven-category contract.

    with patch.object(runtime, "active_model", return_value=(path, digest)):
        live = runtime.load_runtime_classifier()
    assert set(live.classes) == set(LABELS)
    assert live.predict(examples[0]).category == "spam"
    assert sum(live.predict(examples[0]).probabilities.values()) == pytest.approx(1.0)


def test_repeated_updates_replace_the_adapter_without_nesting_models():
    base = LabelModel()
    first = PartialCategoryClassifier(
        base, LabelModel(("fyi", "purchases"), "adapted_label")
    )
    second = PartialCategoryClassifier(
        first, LabelModel(("purchases", "fyi"), "adapted_label")
    )
    assert second.incumbent is base


def test_partial_binary_training_and_inference_work_with_real_sklearn(
    tmp_path, monkeypatch
):
    dataset = Dataset(
        tmp_path,
        tuple(
            row(f"{label}-{i}", label)
            for label in ("fyi", "purchases")
            for i in range(6)
        ),
    )
    config = candidate_configs("logistic-regression")[0]
    monkeypatch.setattr(train, "candidate_configs", lambda _: [config])
    trained = train.train_candidate(dataset, "logistic-regression")
    model = PartialCategoryClassifier(LabelModel(), trained.pipeline)
    examples = [
        {**row("new-purchase"), "base_label": "fyi"},
        {**row("spam"), "base_label": "spam"},
    ]
    assert model.predict(examples)[0] in {"fyi", "purchases"}
    assert model.predict(examples)[1] == "spam"
    assert np.allclose(model.predict_proba(examples).sum(axis=1), 1.0)


def test_supported_category_gate_is_not_diluted_by_missing_labels():
    old = retrain.classification_metrics(["fyi", "purchases"], ["fyi", "purchases"])
    new = copy.deepcopy(old)
    old["per_class"]["fyi"]["f1-score"] = 0.8
    new["per_class"]["fyi"]["f1-score"] = 0.82
    # +0.01 across two categories, only +0.00286 across all seven.
    old["macro_f1"], new["macro_f1"] = 0.5, 0.50286
    assert retrain.promotion_reasons(old, new, supported=("fyi", "purchases")) == []


def test_worker_trains_a_partial_candidate_and_reports_frozen_categories(
    tmp_path, monkeypatch
):
    write_json(tmp_path / "recovery.json", {"started_at": "2030-01-01T00:00:00+00:00"})
    bundle = seed_dataset(tmp_path, partial_rows(), {})
    remote = MemoryStore()
    monkeypatch.setattr(retrain, "seed_dataset", lambda *_: bundle)
    monkeypatch.setattr(retrain, "correction_rows", lambda _: (partial_rows(), 0))
    base = LabelModel()
    monkeypatch.setattr(
        retrain,
        "load_runtime_classifier",
        lambda: SimpleNamespace(model=base, model_version="seed"),
    )
    trained = SimpleNamespace(
        pipeline=LabelModel(("fyi", "purchases"), "adapted_label"), training_seconds=0.1
    )
    captured = []

    def trainer(dataset, _model):
        captured.append(dataset)
        return trained

    monkeypatch.setattr(retrain, "train_candidate", trainer)
    # Reject on equal scores; no unrealistic candidate upload/promotion is needed.
    metrics = retrain.classification_metrics(["fyi", "purchases"], ["fyi", "purchases"])
    monkeypatch.setattr(retrain, "score", lambda *_: metrics)
    report = {}
    assert retrain.execute(tmp_path, "partial-run", report, remote) == "rejected"
    assert set(captured[0].labels) == {"fyi", "purchases"}
    assert report["adapted_categories"] == ["purchases", "fyi"]
    assert "spam" in report["frozen_categories"]
    assert "active_model" not in remote.state
