import { NextResponse } from "next/server"
import { getNutritionSourceStatus } from "@/lib/foods/source"

export function toNutritionSourceErrorResponse(error: unknown) {
  return NextResponse.json(
    { error: "Nutrition source request failed" },
    { status: getNutritionSourceStatus(error) }
  )
}
