import {
  type CreateFoodInput,
  type ExternalFoodNutrition,
  type ExternalFoodSummary,
  externalCreateResponseSchema,
  externalNutritionResponseSchema,
  externalSearchResponseSchema,
  externalSummaryResponseSchema,
  type FoodSearchParams,
} from "@/lib/foods/contracts"

const nutritionApiBaseUrl =
  process.env.NUTRITION_API_BASE_URL ?? "https://nutrition.denizlg24.com"

class NutritionSourceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

function buildUrl(path: string, params?: URLSearchParams) {
  const url = new URL(path, nutritionApiBaseUrl)
  if (params) {
    for (const [key, value] of params.entries()) {
      url.searchParams.set(key, value)
    }
  }
  return url
}

async function fetchSourceJson(url: URL) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-api-key": process.env.NUTRITION_API_KEY ?? "",
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new NutritionSourceError(
      `Nutrition API request failed with ${response.status}`,
      response.status
    )
  }

  return response.json()
}

async function sendSourceJson(url: URL, init: RequestInit) {
  const response = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-api-key": process.env.NUTRITION_API_KEY ?? "",
      ...init.headers,
    },
    cache: "no-store",
  })

  if (!response.ok) {
    throw new NutritionSourceError(
      `Nutrition API request failed with ${response.status}`,
      response.status
    )
  }

  return response.json()
}

function appendOptionalParam(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined
) {
  if (value !== undefined && value !== "") {
    params.set(key, value.toString())
  }
}

export async function searchNutritionFoods(
  input: FoodSearchParams
): Promise<ExternalFoodSummary[]> {
  if (!input.q && !input.brand) {
    return []
  }

  const params = new URLSearchParams()
  appendOptionalParam(params, "q", input.q)
  appendOptionalParam(params, "brand", input.brand)
  appendOptionalParam(params, "lang", input.lang)
  appendOptionalParam(params, "limit", input.limit)
  appendOptionalParam(params, "minScore", input.minScore)

  const json = await fetchSourceJson(buildUrl("/api/items/search", params))
  return externalSearchResponseSchema.parse(json).data
}

export async function getNutritionFoodSummary(
  itemId: string
): Promise<ExternalFoodSummary> {
  const json = await fetchSourceJson(buildUrl(`/api/items/${itemId}`))
  return externalSummaryResponseSchema.parse(json).data
}

export async function getNutritionFoodByBarcode(
  barcode: string
): Promise<ExternalFoodSummary> {
  const json = await fetchSourceJson(
    buildUrl(`/api/items/barcode/${encodeURIComponent(barcode)}`)
  )
  return externalSummaryResponseSchema.parse(json).data
}

export async function getNutritionFoodNutrition(
  itemId: string
): Promise<ExternalFoodNutrition> {
  const json = await fetchSourceJson(buildUrl(`/api/items/${itemId}/nutrition`))
  return externalNutritionResponseSchema.parse(json).data
}

export async function createNutritionFood(input: {
  barcode: string
  name: string
  brand: string | null
  serving: CreateFoodInput["servingSizes"][number]
  nutrients: Record<string, number>
}): Promise<{
  summary: ExternalFoodSummary
  nutrition: ExternalFoodNutrition
}> {
  const payload = {
    barcode: input.barcode,
    name: input.name,
    brand: input.brand,
    nutrition: {
      servingLabel: input.serving.label,
      servingQuantity: input.serving.quantity,
      servingUnit: input.serving.unit,
      ...input.nutrients,
    },
  }

  try {
    const json = await sendSourceJson(buildUrl("/api/items/"), {
      method: "POST",
      body: JSON.stringify(payload),
    })

    const { item, nutrition } = externalCreateResponseSchema.parse(json).data
    return { summary: item, nutrition }
  } catch (error) {
    if (error instanceof NutritionSourceError && error.status === 409) {
      const summary = await getNutritionFoodByBarcode(input.barcode)
      const nutrition = await getNutritionFoodNutrition(summary.id)
      return { summary, nutrition }
    }

    throw error
  }
}

export function getNutritionSourceStatus(error: unknown) {
  return error instanceof NutritionSourceError ? error.status : 502
}
