import pytest

from macros_vision.parser import parse_label_text


@pytest.mark.parametrize(
    ("text", "basis", "calories", "protein"),
    [
        (
            "Per 100 g\nEnergy 840 kJ / 200 kcal\nFat 10 g\nCarbohydrate 20 g\nProtein 5 g",
            "per_100g",
            200,
            5,
        ),
        (
            "Por 100 g\nEnergia 840 kJ 200 kcal\nGordura 10 g\n"
            "Hidratos de carbono 20 g\nProteína 5 g",
            "per_100g",
            200,
            5,
        ),
        (
            "Per serving\nCalories 160 kcal\nTotal Fat 8 g\nTotal Carbohydrate 18 g\nProtein 4 g",
            "per_serving",
            160,
            4,
        ),
        (
            "Por dose\nValor energético 418 kJ 100 kcal\nLípidos 3 g\n"
            "Carboidratos 15 g\nProteínas 4 g",
            "per_serving",
            100,
            4,
        ),
        (
            "Per 100 ml\nEnergy 42 kcal\nFat 1.5 g\nCarbohydrate 5 g\nProtein 3.2 g",
            "per_100ml",
            42,
            3.2,
        ),
    ],
)
def test_primary_formats(text: str, basis: str, calories: float, protein: float) -> None:
    parsed = parse_label_text(text)
    assert parsed.basis == basis
    assert parsed.fields["calories"].value == calories
    assert parsed.fields["protein"].value == protein


@pytest.mark.parametrize(
    "line",
    [
        "Sugars <0.5 g",
        "Of which sugars < 0,5 g",
        "Açúcares <0,5 g",
        "Dos quais açúcares < 0.5 g",
    ],
)
def test_trace_values_are_returned_with_lower_confidence(line: str) -> None:
    parsed = parse_label_text(f"Per 100 g\n{line}")
    assert parsed.fields["sugar"].value == 0.25
    assert parsed.fields["sugar"].confidence < 0.85


def test_ignores_percent_daily_value_column() -> None:
    parsed = parse_label_text("Per serving\nTotal Fat 8 g 10%\nSodium 230 mg 10%")
    assert parsed.fields["fat"].value == 8
    assert parsed.fields["sodium"].value == 230


def test_returns_partial_results() -> None:
    parsed = parse_label_text("Per 100 g\nEnergy 120 kcal\nProtein 4 g")
    assert parsed.fields["calories"].value == 120
    assert parsed.fields["protein"].value == 4
    assert "fiber" not in parsed.fields


def test_warns_on_energy_mismatch_and_reduces_confidence() -> None:
    parsed = parse_label_text(
        "Per 100 g\nEnergy 50 kcal\nFat 20 g\nCarbohydrate 20 g\nProtein 20 g"
    )
    assert parsed.warnings
    assert parsed.fields["calories"].confidence < 0.85


def test_extracts_serving_metadata() -> None:
    parsed = parse_label_text(
        "Serving size: 30 g\nServings per container: 4\nPer serving\nCalories 120 kcal"
    )
    assert parsed.serving_quantity == 30
    assert parsed.serving_unit == "g"
    assert parsed.servings_per_container == 4


@pytest.mark.parametrize(
    ("text", "basis"),
    [
        ("Nutrition Facts\nServing Size 2/3 cup", "per_serving"),
        ("Valeurs nutritionnelles pour 100 g", "per_100g"),
        ("Nährwerte je 100g", "per_100g"),
        ("Typical values per 1OO ml", "per_100ml"),
    ],
)
def test_detects_regional_basis_headers(text: str, basis: str) -> None:
    assert parse_label_text(text).basis == basis
