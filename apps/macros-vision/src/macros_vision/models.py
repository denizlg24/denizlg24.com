from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class NutritionField(BaseModel):
    value: float | None
    unit: Literal["kcal", "kj", "g", "mg", "mcg"]
    confidence: float = Field(ge=0, le=1)


class LabelResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal["v1"] = "v1"
    basis: Literal["per_100g", "per_100ml", "per_serving", "unknown"]
    serving_quantity: float | None = Field(serialization_alias="servingQuantity")
    serving_unit: str | None = Field(serialization_alias="servingUnit")
    servings_per_container: float | None = Field(serialization_alias="servingsPerContainer")
    fields: dict[str, NutritionField]
    raw_text: str = Field(serialization_alias="rawText")
    warnings: list[str]


class Candidate(BaseModel):
    name: str
    confidence: float = Field(ge=0, le=1)


class ClassifyResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    version: Literal["v1"] = "v1"
    candidates: list[Candidate]
    raw_text: str = Field(default="", serialization_alias="rawText")
