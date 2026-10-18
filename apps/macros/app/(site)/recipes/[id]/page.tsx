import { blocksToText } from "@repo/macros-core/recipe-content";
import type { MacrosRecipeDetail } from "@repo/schemas/macros";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { RecipeArticle } from "@/app/_recipes/recipe-article";
import { ShareButton } from "@/app/_recipes/share-button";
import { getPublicRecipe } from "@/lib/recipes/service";

export const dynamic = "force-dynamic";

const SITE = "https://macros.denizlg24.com";

const loadRecipe = cache(async (id: string) =>
  z.uuid().safeParse(id).success ? getPublicRecipe(id) : null,
);

function summaryOf(recipe: MacrosRecipeDetail) {
  const text =
    recipe.description || blocksToText(recipe.story ?? []).replace(/\s+/g, " ");
  return (
    text.slice(0, 160) ||
    `${recipe.name}: ingredients, method and nutrition per serving.`
  );
}

function isoDuration(minutes: number | null | undefined) {
  return minutes ? `PT${minutes}M` : undefined;
}

/** `<` is escaped so recipe text can never close the script element. */
function jsonLd(recipe: MacrosRecipeDetail) {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    description: summaryOf(recipe),
    image: recipe.coverImageUrl
      ? [`${SITE}${recipe.coverImageUrl}`]
      : undefined,
    datePublished: recipe.publishedAt ?? undefined,
    prepTime: isoDuration(recipe.prepTimeMinutes),
    cookTime: isoDuration(recipe.cookTimeMinutes),
    recipeYield: `${recipe.servings} servings`,
    recipeIngredient: recipe.ingredients.map((ingredient) =>
      [ingredient.amountLabel, ingredient.foodName].filter(Boolean).join(" "),
    ),
    recipeInstructions: (recipe.steps ?? []).map((step) => ({
      "@type": "HowToStep",
      name: step.title || undefined,
      text: blocksToText(step.blocks),
    })),
    nutrition: {
      "@type": "NutritionInformation",
      calories: `${Math.round(recipe.caloriesPerServing)} kcal`,
      proteinContent: `${Math.round(recipe.proteinPerServing)} g`,
      carbohydrateContent: `${Math.round(recipe.carbsPerServing)} g`,
      fatContent: `${Math.round(recipe.fatPerServing)} g`,
    },
  }).replace(/</g, "\\u003c");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const recipe = await loadRecipe((await params).id);
  if (!recipe) return { title: "Recipe not found" };
  const description = summaryOf(recipe);
  return {
    title: `${recipe.name} · Recipes`,
    description,
    alternates: { canonical: `${SITE}/recipes/${recipe.id}` },
    openGraph: {
      type: "article",
      title: recipe.name,
      description,
      publishedTime: recipe.publishedAt ?? undefined,
      ...(recipe.coverImageUrl
        ? { images: [`${SITE}${recipe.coverImageUrl}`] }
        : {}),
    },
  };
}

export default async function RecipePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const recipe = await loadRecipe((await params).id);
  if (!recipe) notFound();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(recipe) }}
      />
      <RecipeArticle
        recipe={recipe}
        actions={
          <ShareButton
            title={recipe.name}
            url={`${SITE}/recipes/${recipe.id}`}
          />
        }
      />
    </>
  );
}
