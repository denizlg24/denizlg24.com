import re
import unicodedata
from collections import Counter
from dataclasses import dataclass
from itertools import product

from .models import LabelResponse, NutritionField

NUMBER = r"(?P<trace><\s*)?(?P<value>\d+(?:[.,]\d+)?)"
UNIT = r"(?P<unit>kcal|kj|kJ|g|mg|µg|μg|mcg)"
VALUE_PATTERN = re.compile(rf"{NUMBER}\s*{UNIT}\b", re.IGNORECASE)
SERVING_PATTERN = re.compile(
    r"(?:serving size|porcao|dose|portionsstorrelse|porsjonsstorrelse|"
    r"portionsstorlek|portionsgrosse|taille de portion|tamano de la porcion|"
    r"porzione|portiegrootte)[^\n]{0,80}?(\d+(?:[.,]\d+)?)\s*(g|ml)\b",
    re.IGNORECASE,
)
SERVINGS_PATTERN = re.compile(
    r"(?:(?:servings per container|por[cç][oõ]es por embalagem)\s*:?\s*(\d+(?:[.,]\d+)?)|"
    r"(\d+(?:[.,]\d+)?)\s*(?:servings per container|por[cç][oõ]es por embalagem))",
    re.IGNORECASE,
)
CALORIE_PATTERNS = (
    re.compile(
        r"(?:calories|calorias)\s*(?:per serving\s*)?(\d{1,4}(?:[.,]\d+)?)\b",
        re.IGNORECASE,
    ),
    re.compile(r"amount per serving\s*(\d{1,4}(?:[.,]\d+)?)\s*(?:calories)?\b", re.IGNORECASE),
    re.compile(r"(\d{1,4}(?:[.,]\d+)?)\s*(?:calories|calorias)\b", re.IGNORECASE),
)


@dataclass(frozen=True)
class Alias:
    key: str
    phrases: tuple[str, ...]
    default_unit: str


ALIASES = (
    Alias(
        "calories",
        (
            "energy",
            "energia",
            "energi",
            "energie",
            "brennwert",
            "valor energetico",
            "wartosc energetyczna",
            "calories",
            "calorias",
        ),
        "kcal",
    ),
    Alias(
        "fat",
        (
            "total fat",
            "fat",
            "gordura total",
            "lipidos",
            "grasas",
            "grassi",
            "fedt",
            "fett",
            "vetten",
            "vet",
            "rasva",
            "tluszcz",
            "matieres grasses",
        ),
        "g",
    ),
    Alias(
        "saturated",
        (
            "saturated fat",
            "sat. fat",
            "sat fat",
            "saturates",
            "dos quais saturados",
            "gordura saturada",
            "de las cuales saturadas",
            "dont acides gras satures",
            "davon gesattigte fettsauren",
            "heraf maettede fedtsyrer",
            "hvoraf maettede fedtsyrer",
            "varav mattade fettsyror",
            "hvorav mettede fettsyrer",
            "waarvan verzadigde vetzuren",
            "di cui acidi grassi saturi",
            "josta tyydyttyneita",
            "w tym kwasy tluszczowe nasycone",
        ),
        "g",
    ),
    Alias("transFat", ("trans fat",), "g"),
    Alias(
        "carbs",
        (
            "total carbohydrate",
            "total carb.",
            "total carb",
            "carbohydrate",
            "hidratos de carbono",
            "carboidratos",
            "glucides",
            "kohlenhydrate",
            "kulhydrat",
            "kolhydrat",
            "karbohydrat",
            "koolhydraten",
            "carboidrati",
            "hiilihydraatit",
            "weglowodany",
        ),
        "g",
    ),
    Alias(
        "sugar",
        (
            "of which sugars",
            "sugars",
            "dos quais acucares",
            "acucares",
            "de los cuales azucares",
            "dont sucres",
            "davon zucker",
            "heraf sukkerarter",
            "hvoraf sukkerarter",
            "varav sockerarter",
            "hvorav sukkerarter",
            "waarvan suikers",
            "di cui zuccheri",
            "josta sokereita",
            "w tym cukry",
        ),
        "g",
    ),
    Alias("addedSugar", ("added sugars", "added sugar"), "g"),
    Alias(
        "fiber",
        (
            "dietary fiber",
            "fibre",
            "fiber",
            "fibra",
            "fibres alimentaires",
            "ballaststoffe",
            "kostfibre",
            "kostfiber",
            "vezels",
            "ravintokuitu",
            "blonnik",
        ),
        "g",
    ),
    Alias(
        "protein",
        (
            "protein",
            "proteine",
            "proteines",
            "proteina",
            "proteinas",
            "proteine",
            "eiweiss",
            "eiwitten",
            "proteiini",
            "bialko",
        ),
        "g",
    ),
    Alias("salt", ("salt", "sal", "sel", "salz", "zout", "sale", "suola", "sol"), "g"),
    Alias(
        "sodium",
        ("sodium", "sodio", "natrium", "natriumin", "sod"),
        "mg",
    ),
    Alias("cholesterol", ("cholesterol", "colesterol"), "mg"),
    Alias("potassium", ("potassium", "potassio"), "mg"),
    Alias("calcium", ("calcium", "calcio"), "mg"),
    Alias("iron", ("iron", "ferro"), "mg"),
    Alias("d", ("vitamin d", "vit. d", "vit d"), "mcg"),
)


def _plain(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    plain = "".join(char for char in normalized if not unicodedata.combining(char))
    return plain.lower().translate(str.maketrans({"ø": "o", "æ": "ae", "ß": "ss", "ł": "l"}))


def _number(value: str) -> float:
    return float(value.replace(",", "."))


def _unit(value: str) -> str:
    normalized = value.lower().replace("µ", "u").replace("μ", "u")
    return "mcg" if normalized in {"ug", "mcg"} else normalized


def _convert_unit(value: float, source: str, target: str) -> float | None:
    if source == target:
        return value
    mass_scale = {"g": 1_000_000, "mg": 1_000, "mcg": 1}
    if source in mass_scale and target in mass_scale:
        return value * mass_scale[source] / mass_scale[target]
    return None


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
    return _phrase_match(line, phrase) is not None


def _phrase_match(line: str, phrase: str) -> re.Match[str] | None:
    normalized_phrase = _plain(phrase)
    return re.search(rf"(?<![a-z]){re.escape(normalized_phrase)}(?![a-z])", line)


def _value_region(line: str, plain_line: str, match: re.Match[str]) -> str:
    end = len(line)
    tail = plain_line[match.end() :]
    for alias in ALIASES:
        for phrase in alias.phrases:
            next_match = _phrase_match(tail, phrase)
            if next_match is not None:
                end = min(end, match.end() + next_match.start())
    return line[match.end() : end]


def _extract_bare_calories(raw_text: str) -> NutritionField | None:
    values: list[float] = []
    for pattern in CALORIE_PATTERNS:
        for match in pattern.finditer(raw_text):
            value = _number(match.group(1))
            if 0 <= value <= 1_500:
                values.append(value)
    if not values:
        return None
    counts = Counter(values)
    value = max(counts, key=lambda candidate: (counts[candidate], candidate))
    return NutritionField(value=round(value, 3), unit="kcal", confidence=0.8)


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
        or "per portion" in plain
        or "pro portion" in plain
        or "par portion" in plain
        or "por porcion" in plain
        or "per porzione" in plain
        or "per portie" in plain
        or "na porcje" in plain
        or "annosta kohden" in plain
    ):
        return "per_serving"
    return "unknown"


def parse_label_text(
    raw_text: str,
    ocr_confidence: float = 0.85,
    expected_format: str | None = None,
) -> LabelResponse:
    lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
    candidates: dict[str, list[NutritionField]] = {}
    warnings: list[str] = []

    bare_calories = _extract_bare_calories(raw_text)
    if bare_calories is not None:
        candidates["calories"] = [bare_calories]

    for line in lines:
        plain_line = _plain(line)
        for alias in ALIASES:
            alias_match = next(
                (
                    match
                    for phrase in alias.phrases
                    if (match := _phrase_match(plain_line, phrase)) is not None
                ),
                None,
            )
            if alias_match is None:
                continue
            if alias.key == "fat" and any(
                _has_phrase(plain_line, phrase)
                for item in ALIASES
                if item.key in {"saturated", "transFat"}
                for phrase in item.phrases
            ):
                continue
            if alias.key == "carbs" and any(
                _has_phrase(plain_line, phrase)
                for phrase in next(item for item in ALIASES if item.key == "sugar").phrases
            ):
                continue
            extracted = _extract_value(
                _value_region(line, plain_line, alias_match), alias.default_unit
            )
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
            elif unit != alias.default_unit:
                converted = _convert_unit(value, unit, alias.default_unit)
                if converted is None:
                    continue
                value, unit = converted, alias.default_unit
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
    if expected_format == "eu" and basis != "per_100ml":
        basis = "per_100g"
    elif expected_format == "us":
        basis = "per_serving"
    fields = _select_candidates(candidates, basis)
    salt = fields.get("salt")
    if "sodium" not in fields and salt is not None and salt.value is not None and salt.unit == "g":
        fields["sodium"] = NutritionField(
            value=round(salt.value * 400, 3),
            unit="mg",
            confidence=round(salt.confidence * 0.9, 3),
        )

    text_plain = _plain(raw_text)
    serving_match = SERVING_PATTERN.search(text_plain)
    servings_match = SERVINGS_PATTERN.search(text_plain)
    serving_quantity = _number(serving_match.group(1)) if serving_match else None
    serving_unit = serving_match.group(2).lower() if serving_match else None
    servings_per_container = (
        _number(servings_match.group(1) or servings_match.group(2)) if servings_match else None
    )

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

    for key, ceiling in (
        ("fiber", 100),
        ("transFat", 100),
        ("addedSugar", 100),
        ("salt", 10),
        ("sodium", 5_000),
        ("cholesterol", 2_000),
        ("potassium", 10_000),
        ("calcium", 5_000),
        ("iron", 1_000),
        ("d", 1_000),
    ):
        options = usable(key, ceiling)
        if options:
            fields[key] = options[0]
    return fields
