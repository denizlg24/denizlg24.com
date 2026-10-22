import { blocksToText } from "@repo/macros-core/recipe-content";
import type { MacrosRecipeDetail } from "@repo/schemas/macros";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ingredientName, RecipeArticle } from "@/app/_recipes/recipe-article";
import { ShareButton } from "@/app/_recipes/share-button";
import { getPublicAppOrigin } from "@/lib/email";
import { recipeShareImagePath } from "@/lib/recipes/share-image";
import { loadPublicRecipe, publicRecipeParams } from "./load";

export const revalidate = 3600;
export const dynamicParams = true;

type Props = { params: Promise<{ id: string }> };

export function generateStaticParams() {
  return publicRecipeParams();
}

function recipeUrl(id: string) {
  return `${getPublicAppOrigin()}/recipes/${id}`;
}

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
  const origin = getPublicAppOrigin();
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Recipe",
    name: recipe.name,
    description: summaryOf(recipe),
    image: [
      recipe.coverImageUrl
        ? `${origin}${recipe.coverImageUrl}`
        : `${origin}${recipeShareImagePath(recipe.id)}`,
    ],
    author: { "@type": "Organization", name: "Macros Recipes" },
    datePublished: recipe.publishedAt ?? undefined,
    dateModified: recipe.updatedAt,
    prepTime: isoDuration(recipe.prepTimeMinutes),
    cookTime: isoDuration(recipe.cookTimeMinutes),
    recipeYield: `${recipe.servings} servings`,
    recipeIngredient: recipe.ingredients.map((ingredient) =>
      [ingredient.amountLabel, ingredientName(ingredient)]
        .filter(Boolean)
        .join(" "),
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const recipe = await loadPublicRecipe((await params).id);
  if (!recipe) return { title: "Recipe not found", robots: { index: false } };
  const description = summaryOf(recipe);
  const path = `/recipes/${recipe.id}`;
  return {
    title: `${recipe.name} · Recipes`,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "article",
      siteName: "Macros",
      url: path,
      title: recipe.name,
      description,
      publishedTime: recipe.publishedAt ?? undefined,
      modifiedTime: recipe.updatedAt,
    },
    twitter: {
      card: "summary_large_image",
      title: recipe.name,
      description,
    },
  };
}

export default async function RecipePage({ params }: Props) {
  const recipe = await loadPublicRecipe((await params).id);
  if (!recipe) notFound();
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(recipe) }}
      />
      <RecipeArticle
        recipe={recipe}
        actions={<ShareButton title={recipe.name} url={recipeUrl(recipe.id)} />}
      />
    </>
  );
}
