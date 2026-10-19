import type { MetadataRoute } from "next";
import { getPublicAppOrigin } from "@/lib/email";
import { failOpenAtBuild } from "@/lib/fail-open";
import { recipeBrowsePath, recipePageParams } from "@/lib/recipes/pagination";
import { getPublicRecipeIndex } from "@/lib/recipes/service";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = getPublicAppOrigin();
  const recipes = await failOpenAtBuild(
    "public recipe index",
    getPublicRecipeIndex,
    [],
  );
  return [
    { url: `${origin}/`, changeFrequency: "monthly", priority: 1 },
    { url: `${origin}/features`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/recipes`, changeFrequency: "daily", priority: 0.8 },
    ...recipePageParams(recipes.length).map(({ n }) => ({
      url: `${origin}${recipeBrowsePath(Number(n))}`,
      changeFrequency: "daily" as const,
      priority: 0.4,
    })),
    ...recipes.map((recipe) => ({
      url: `${origin}/recipes/${recipe.id}`,
      lastModified: recipe.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    })),
    { url: `${origin}/coach`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${origin}/download`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/changelog`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${origin}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${origin}/support`, changeFrequency: "yearly", priority: 0.4 },
    {
      url: `${origin}/account/delete`,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
