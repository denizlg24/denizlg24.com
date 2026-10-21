import { NextResponse } from "next/server";
import { getRequiredSession } from "@/lib/api/session";
import { foodSearchParamsSchema } from "@/lib/foods/contracts";
import { searchFoods } from "@/lib/foods/search";
import { toNutritionSourceErrorResponse } from "../_lib/source-error-response";

export async function GET(request: Request) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const url = new URL(request.url);
  const parsed = foodSearchParamsSchema.safeParse({
    q: url.searchParams.get("q") ?? undefined,
    brand: url.searchParams.get("brand") ?? undefined,
    lang: url.searchParams.get("lang") ?? undefined,
    limit: url.searchParams.get("limit") ?? undefined,
    minScore: url.searchParams.get("minScore") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid food search", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await searchFoods(session.user.id, parsed.data));
  } catch (error) {
    return toNutritionSourceErrorResponse(error);
  }
}
