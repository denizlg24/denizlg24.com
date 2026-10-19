import { readBodyPhotoObject } from "@/lib/body/storage";
import { isJpeg } from "@/lib/recipes/images";
import { loadPublicRecipe, publicRecipeParams } from "./load";
import { renderRecipeShareCard } from "./share-card";

export const revalidate = 3600;
export const dynamicParams = true;

export const alt = "A recipe on Macros";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return publicRecipeParams();
}

/** A missing or unreadable cover still gets a card, just the typographic one. */
async function coverDataUrl(key: string | null) {
  if (!key) return null;
  try {
    const bytes = await readBodyPhotoObject(key);
    if (!isJpeg(bytes)) return null;
    return `data:image/jpeg;base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (error) {
    console.warn(
      `[macros] recipe cover ${key} unreadable for its share image:`,
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

export default async function Image({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const recipe = await loadPublicRecipe((await params).id);
  if (!recipe) return new Response(null, { status: 404 });
  return renderRecipeShareCard(
    {
      name: recipe.name,
      calories: recipe.caloriesPerServing,
      protein: recipe.proteinPerServing,
      carbs: recipe.carbsPerServing,
      fat: recipe.fatPerServing,
      cover: await coverDataUrl(recipe.coverImageKey ?? null),
    },
    size,
  );
}
