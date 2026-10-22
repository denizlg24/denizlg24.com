import {
  type MacrosPantryResponse,
  macrosSetPantryRecipeBodySchema,
  macrosStorePantryRecipeBodySchema,
} from "@repo/schemas/macros";
import { NextResponse } from "next/server";
import type { z } from "zod";
import { getRequiredSession } from "@/lib/api/session";
import {
  getPantryResponse,
  PantryRecipeNotFoundError,
  setPantryRecipe,
  storePantryRecipe,
} from "@/lib/pantry/service";

async function handle<T extends z.ZodType>(
  request: Request,
  schema: T,
  write: (userId: string, body: z.infer<T>) => Promise<void>,
) {
  const { session, response } = await getRequiredSession();
  if (!session) return response;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      {
        error: "Enter a valid recipe and number of servings",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  try {
    await write(session.user.id, parsed.data);
  } catch (error) {
    if (error instanceof PantryRecipeNotFoundError)
      return NextResponse.json({ error: error.message }, { status: 404 });
    throw error;
  }
  return NextResponse.json(
    (await getPantryResponse(session.user.id)) satisfies MacrosPantryResponse,
  );
}

/** Sets the stored servings on hand. */
export function PUT(request: Request) {
  return handle(request, macrosSetPantryRecipeBodySchema, setPantryRecipe);
}

/** Stores a batch just cooked, using up its ingredients when asked to. */
export function POST(request: Request) {
  return handle(request, macrosStorePantryRecipeBodySchema, storePantryRecipe);
}
