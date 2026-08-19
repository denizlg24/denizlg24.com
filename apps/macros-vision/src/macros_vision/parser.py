import re
import unicodedata
from dataclasses import dataclass
from itertools import product

from .models import LabelResponse, NutritionField

NUMBER = r"(?P<trace><\s*)?(?P<value>\d+(?:[.,]\d+)?)"
UNIT = r"(?P<unit>kcal|kj|kJ|g|mg|µg|μg|mcg)"
VALUE_PATTERN = re.compile(rf"{NUMBER}\s*{UNIT}\b", re.IGNORECASE)
SERVING_PATTERN = re.compile(
    r"(?:serving size|por[cç][aã]o|dose)\s*:?[\s]*(\d+(?:[.,]\d+)?)\s*(g|ml)",
    re.IGNORECASE,
)
SERVINGS_PATTERN = re.compile(
    r"(?:servings per container|por[cç][oõ]es por embalagem)\s*:?[\s]*(\d+(?:[.,]\d+)?)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Alias:
    key: str
    phrases: tuple[str, ...]
    default_unit: str


ALIASES = (
    Alias("calories", ("energy", "energia", "valor energetico", "calories", "calorias"), "kcal"),
    Alias("fat", ("total fat", "fat", "gordura total", "lipidos"), "g"),
    Alias(
        "saturated",
        ("saturated fat", "saturates", "dos quais saturados", "gordura saturada"),
        "g",
    ),
    Alias(
        "carbs",
        ("total carbohydrate", "carbohydrate", "hidratos de carbono", "carboidratos"),
        "g",
    ),
    Alias("sugar", ("of which sugars", "sugars", "dos quais acucares", "acucares"), "g"),
    Alias("fiber", ("dietary fiber", "fibre", "fiber", "fibra"), "g"),
    Alias("protein", ("protein", "proteina", "proteinas"), "g"),
    Alias("salt", ("salt", "sal"), "g"),
    Alias("sodium", ("sodium", "sodio"), "mg"),
    Alias("cholesterol", ("cholesterol", "colesterol"), "mg"),
)


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    return "".join(char for char in normalized if not unicodedata.combining(char)).lower()


def _number(value: str) -> float:
    return float(value.replace(",", "."))


def _unit(value: str) -> str:
    normalized = value.lower().replace("µ", "u").replace("μ", "u")
    return "mcg" if normalized in {"ug", "mcg"} else normalized


def _extract_value(line: str, preferred_unit: str) -> tuple[float, str, bool] | None:
    matches = list(VALUE_PATTERN.finditer(line))
    if not matches:
        return None
    usable = [match for match in matches if not line[match.end() :].lstrip().startswith("%")]
    if not usable:
        return None
    preferred = next(
        (match for match in usable if _unit(match.group("unit")) == preferred_unit),
        usable[0],
    )
    value = _number(preferred.group("value"))
    trace = preferred.group("trace") is not None
    return (value / 2 if trace else value, _unit(preferred.group("unit")), trace)


def _has_phrase(line: str, phrase: str) -> bool:
    return re.search(rf"(?<![a-z]){re.escape(phrase)}(?![a-z])", line) is not None


def _basis(text: str) -> str:
    plain = _plain(text)
    per_100 = r"(?:per|por|pour|par|pro|pr\.?|je)?\s*1[0o]{2}\s*"
    if re.search(rf"{per_100}g\b", plain):
        return "per_100g"
    if re.search(rf"{per_100}ml\b", plain):
        return "per_100ml"
    if (
        "per serving" in plain
        or "serving size" in plain
        or "servings per container" in plain
        or "por porcao" in plain
        or "por dose" in plain
    ):
        return "per_serving"
    return "unknown"


def parse_label_text(raw_text: str, ocr_confidence: float = 0.85) -> LabelResponse:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    candidates: dict[str, list[NutritionField]] = {}
    warnings: list[str] = []

    for line in lines:
        plain_line = _plain(line)
        for alias in ALIASES:
            if not any(_has_phrase(plain_line, phrase) for phrase in alias.phrases):
                continue
            if alias.key == "fat" and any(
                _has_phrase(plain_line, phrase) for phrase in ALIASES[2].phrases
            ):
                continue
            if alias.key == "carbs" and any(
                _has_phrase(plain_line, phrase) for phrase in ALIASES[4].phrases
            ):
                continue
            extracted = _extract_value(line, alias.default_unit)
            if extracted is None:
                continue
            value, unit, trace = extracted
            if alias.key == "calories" and unit not in {"kcal", "kj"}:
                continue
            if alias.key == "calories" and unit == "kj":
                kcal_match = next(
                    (
                        match
                        for match in VALUE_PATTERN.finditer(line)
                        if _unit(match.group("unit")) == "kcal"
                    ),
                    None,
                )
                if kcal_match:
                    value, unit = _number(kcal_match.group("value")), "kcal"
                else:
                    value, unit = value / 4.184, "kcal"
            candidate = NutritionField(
                value=round(value, 3),
                unit=unit,
                confidence=max(0.05, min(0.99, ocr_confidence * (0.7 if trace else 1))),
            )
            values = candidates.setdefault(alias.key, [])
            if not any(
                item.value == candidate.value and item.unit == candidate.unit for item in values
            ):
                values.append(candidate)

    basis = _basis(raw_text)
    fields = _select_candidates(candidates, basis)

    text_plain = _plain(raw_text)
    serving_match = SERVING_PATTERN.search(text_plain)
    servings_match = SERVINGS_PATTERN.search(text_plain)
    serving_quantity = _number(serving_match.group(1)) if serving_match else None
    serving_unit = serving_match.group(2).lower() if serving_match else None
    servings_per_container = _number(servings_match.group(1)) if servings_match else None

    calories = fields.get("calories")
    protein = fields.get("protein")
    carbs = fields.get("carbs")
    fat = fields.get("fat")
    if calories and all(field and field.value is not None for field in (protein, carbs, fat)):
        macro_energy = protein.value * 4 + carbs.value * 4 + fat.value * 9  # type: ignore[union-attr]
        if calories.value and abs(macro_energy - calories.value) > max(50, calories.value * 0.3):
            warnings.append("Macro energy does not reconcile with stated calories")
    gram_total = sum(
        field.value or 0
        for key, field in fields.items()
        if field.unit == "g" and key not in {"calories", "saturated", "sugar"}
    )
    if basis in {"per_100g", "per_100ml"} and gram_total > 105:
        warnings.append("Parsed nutrients exceed 100 g per 100 g/ml")
    if basis == "unknown":
        warnings.append("Could not determine whether values are per 100 g or per serving")
    if warnings:
        fields = {
            key: field.model_copy(update={"confidence": round(field.confidence * 0.7, 3)})
            for key, field in fields.items()
        }

    return LabelResponse(
        basis=basis,
        serving_quantity=serving_quantity,
        serving_unit=serving_unit,
        servings_per_container=servings_per_container,
        fields=fields,
        raw_text=raw_text,
        warnings=warnings,
    )


def _select_candidates(
    candidates: dict[str, list[NutritionField]], basis: str
) -> dict[str, NutritionField]:
    fields: dict[str, NutritionField] = {}

    def usable(key: str, ceiling: float) -> list[NutritionField]:
        return [
            field
            for field in candidates.get(key, [])
            if field.value is not None and 0 <= field.value <= ceiling
        ]

    calorie_options = usable("calories", 1_500)
    if calorie_options:
        fields["calories"] = calorie_options[0]

    macro_options = {key: usable(key, 100) for key in ("fat", "carbs", "protein")}
    if all(macro_options.values()) and calorie_options:
        calories = fields["calories"].value or 0
        combinations = product(
            macro_options["fat"], macro_options["carbs"], macro_options["protein"]
        )
        fat, carbs, protein = min(
            combinations,
            key=lambda values: abs(
                (values[0].value or 0) * 9
                + (values[1].value or 0) * 4
                + (values[2].value or 0) * 4
                - calories
            ),
        )
        fields.update({"fat": fat, "carbs": carbs, "protein": protein})
    else:
        for key, options in macro_options.items():
            if options:
                fields[key] = options[0]

    for key, parent in (("saturated", "fat"), ("sugar", "carbs")):
        parent_value = fields.get(parent)
        ceiling = parent_value.value if parent_value and parent_value.value is not None else 100
        options = usable(key, ceiling)
        if options:
            fields[key] = options[0]

    for key, ceiling in (("fiber", 100), ("salt", 10), ("sodium", 5_000), ("cholesterol", 2_000)):
        options = usable(key, ceiling)
        if options:
            fields[key] = options[0]
    return fields
