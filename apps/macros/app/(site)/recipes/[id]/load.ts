import { cache } from "react";
import { z } from "zod";
import { failOpenAtBuild } from "@/lib/fail-open";
import { getPublicRecipe, getPublicRecipeIndex } from "@/lib/recipes/service";

export const loadPublicRecipe = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? getPublicRecipe(id) : null,
);

export async function publicRecipeParams() {
  const index = await failOpenAtBuild(
    "public recipe index",
    getPublicRecipeIndex,
    [],
  );
  return index.map(({ id }) => ({ id }));
}
