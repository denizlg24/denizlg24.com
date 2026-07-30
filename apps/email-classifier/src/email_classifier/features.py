"""Field-aware text, sender, and structural email features."""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any
from urllib.parse import urlparse

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.preprocessing import MaxAbsScaler, OneHotEncoder

URL_PATTERN = re.compile(r"https?://[^\s<>\"')]+", re.IGNORECASE)
EMAIL_PATTERN = re.compile(
    r"(?<![\w.+-])([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})(?![\w.-])",
    re.IGNORECASE,
)
REPLY_PREFIX = re.compile(r"^\s*(?:re|res)\s*:", re.IGNORECASE)
FORWARD_PREFIX = re.compile(r"^\s*(?:fw|fwd|enc)\s*:", re.IGNORECASE)
UNSUBSCRIBE = re.compile(
    r"\b(?:unsubscribe|opt[\s-]?out|cancelar subscri[cç][aã]o)\b",
    re.IGNORECASE,
)
ACTION_LANGUAGE = re.compile(
    r"\b(?:reply|respond|submit|complete|confirm|approve|review|pay|"
    r"responder|enviar|submeter|confirmar|preencher|prazo|deadline|"
    r"action required|a[cç][aã]o necess[aá]ria)\b",
    re.IGNORECASE,
)
SCHEDULE_LANGUAGE = re.compile(
    r"\b(?:meeting|appointment|calendar|webinar|workshop|exam|class|"
    r"reuni[aã]o|consulta|calend[aá]rio|exame|aula|sess[aã]o)\b",
    re.IGNORECASE,
)
TRANSACTION_LANGUAGE = re.compile(
    r"\b(?:receipt|invoice|order|shipped|delivered|payment|refund|"
    r"recibo|fatura|encomenda|enviado|entregue|pagamento|reembolso)\b",
    re.IGNORECASE,
)


class FieldTextExtractor(BaseEstimator, TransformerMixin):
    """Select and combine string fields from row dictionaries."""

    def __init__(self, fields: tuple[str, ...]) -> None:
        self.fields = fields

    def fit(
        self,
        rows: Sequence[dict[str, Any]],
        labels: Sequence[str] | None = None,
    ) -> FieldTextExtractor:
        del rows, labels
        return self

    def transform(self, rows: Sequence[dict[str, Any]]) -> list[str]:
        return [
            "\n".join(str(row.get(field) or "") for field in self.fields)
            for row in rows
        ]

    def get_feature_names_out(
        self, input_features: Sequence[str] | None = None
    ) -> np.ndarray:
        del input_features
        return np.asarray(self.fields, dtype=object)


class SenderCategoryExtractor(BaseEstimator, TransformerMixin):
    """Extract exact sender/domain categories for one-hot encoding."""

    def fit(
        self,
        rows: Sequence[dict[str, Any]],
        labels: Sequence[str] | None = None,
    ) -> SenderCategoryExtractor:
        del rows, labels
        return self

    def transform(self, rows: Sequence[dict[str, Any]]) -> np.ndarray:
        return np.asarray(
            [
                [
                    str(row.get("sender_address") or "").casefold(),
                    str(row.get("sender_domain") or "").casefold(),
                ]
                for row in rows
            ],
            dtype=object,
        )

    def get_feature_names_out(
        self, input_features: Sequence[str] | None = None
    ) -> np.ndarray:
        del input_features
        return np.asarray(["sender_address", "sender_domain"], dtype=object)


class EmailMetadataExtractor(BaseEstimator, TransformerMixin):
    """Create deterministic structural and lexical indicator features."""

    FEATURE_NAMES = (
        "subject_length_log",
        "body_length_log",
        "url_count_log",
        "email_count_log",
        "attachment_count_log",
        "digit_ratio",
        "uppercase_ratio",
        "exclamation_count_log",
        "has_reply_prefix",
        "has_forward_prefix",
        "has_unsubscribe",
        "has_action_language",
        "has_schedule_language",
        "has_transaction_language",
        "has_html",
        "sender_name_address_mismatch",
        "link_sender_domain_mismatch",
    )

    def fit(
        self,
        rows: Sequence[dict[str, Any]],
        labels: Sequence[str] | None = None,
    ) -> EmailMetadataExtractor:
        del rows, labels
        return self

    @staticmethod
    def _ratios(text: str) -> tuple[float, float]:
        characters = [character for character in text if character.isalpha()]
        uppercase = (
            sum(character.isupper() for character in characters)
            / len(characters)
            if characters
            else 0.0
        )
        digits = sum(character.isdigit() for character in text) / max(len(text), 1)
        return digits, uppercase

    @staticmethod
    def _sender_mismatch(name: str, address: str) -> float:
        mentioned = {match.casefold() for match in EMAIL_PATTERN.findall(name)}
        return float(bool(mentioned and address.casefold() not in mentioned))

    @staticmethod
    def _link_mismatch(body: str, sender_domain: str) -> float:
        if not sender_domain:
            return 0.0
        domains: set[str] = set()
        for url in URL_PATTERN.findall(body):
            try:
                hostname = urlparse(url).hostname or ""
            except ValueError:
                continue
            domains.add(hostname.casefold().removeprefix("www."))
        domains.discard("")
        if not domains:
            return 0.0
        sender = sender_domain.casefold().removeprefix("www.")
        return float(
            all(
                domain != sender
                and not domain.endswith(f".{sender}")
                and not sender.endswith(f".{domain}")
                for domain in domains
            )
        )

    def transform(self, rows: Sequence[dict[str, Any]]) -> csr_matrix:
        values: list[list[float]] = []
        for row in rows:
            subject = str(row.get("subject") or "")
            body = str(row.get("body") or "")
            text = f"{subject}\n{body}"
            address = str(row.get("sender_address") or "")
            sender_domain = str(row.get("sender_domain") or "")
            digit_ratio, uppercase_ratio = self._ratios(text)
            urls = URL_PATTERN.findall(text)
            values.append(
                [
                    math.log1p(len(subject)),
                    math.log1p(len(body)),
                    math.log1p(len(urls)),
                    math.log1p(len(EMAIL_PATTERN.findall(text))),
                    math.log1p(max(int(row.get("attachment_count") or 0), 0)),
                    digit_ratio,
                    uppercase_ratio,
                    math.log1p(text.count("!")),
                    float(bool(REPLY_PREFIX.search(subject))),
                    float(bool(FORWARD_PREFIX.search(subject))),
                    float(bool(UNSUBSCRIBE.search(text))),
                    float(bool(ACTION_LANGUAGE.search(text))),
                    float(bool(SCHEDULE_LANGUAGE.search(text))),
                    float(bool(TRANSACTION_LANGUAGE.search(text))),
                    float(bool(row.get("has_html"))),
                    self._sender_mismatch(
                        str(row.get("sender_name") or ""), address
                    ),
                    self._link_mismatch(body, sender_domain),
                ]
            )
        return csr_matrix(np.asarray(values, dtype=np.float64))

    def get_feature_names_out(
        self, input_features: Sequence[str] | None = None
    ) -> np.ndarray:
        del input_features
        return np.asarray(self.FEATURE_NAMES, dtype=object)


def _text_branch(
    name: str,
    fields: tuple[str, ...],
    *,
    analyzer: str,
    ngram_range: tuple[int, int],
    min_df: int,
    max_features: int,
) -> tuple[str, Pipeline]:
    return (
        name,
        Pipeline(
            [
                ("select", FieldTextExtractor(fields)),
                (
                    "tfidf",
                    TfidfVectorizer(
                        analyzer=analyzer,
                        lowercase=True,
                        max_features=max_features,
                        min_df=min_df,
                        ngram_range=ngram_range,
                        strip_accents=None,
                        sublinear_tf=True,
                    ),
                ),
            ]
        ),
    )


def build_features(
    *,
    word_ngram_range: tuple[int, int] = (1, 2),
    char_ngram_range: tuple[int, int] = (3, 5),
    min_df: int = 2,
) -> FeatureUnion:
    """Build field-specific text, exact sender, and metadata features."""
    return FeatureUnion(
        [
            _text_branch(
                "subject_word",
                ("subject",),
                analyzer="word",
                ngram_range=word_ngram_range,
                min_df=min_df,
                max_features=40_000,
            ),
            _text_branch(
                "subject_char",
                ("subject",),
                analyzer="char_wb",
                ngram_range=char_ngram_range,
                min_df=min_df,
                max_features=50_000,
            ),
            _text_branch(
                "body_word",
                ("body",),
                analyzer="word",
                ngram_range=word_ngram_range,
                min_df=min_df,
                max_features=60_000,
            ),
            _text_branch(
                "body_char",
                ("body",),
                analyzer="char_wb",
                ngram_range=char_ngram_range,
                min_df=min_df,
                max_features=120_000,
            ),
            _text_branch(
                "sender_char",
                ("sender_name", "sender_address", "sender_domain"),
                analyzer="char_wb",
                ngram_range=(2, 5),
                min_df=min_df,
                max_features=30_000,
            ),
            (
                "sender_category",
                Pipeline(
                    [
                        ("select", SenderCategoryExtractor()),
                        (
                            "one_hot",
                            OneHotEncoder(
                                handle_unknown="ignore",
                                min_frequency=2,
                            ),
                        ),
                    ]
                ),
            ),
            (
                "metadata",
                Pipeline(
                    [
                        ("extract", EmailMetadataExtractor()),
                        ("scale", MaxAbsScaler()),
                    ]
                ),
            ),
        ]
    )
