import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/app/metadata";
import { failOpenAtBuild } from "@/lib/fail-open";
import {
  parseRecipePage,
  recipeBrowsePath,
  recipePageParams,
} from "@/lib/recipes/pagination";
import { countPublicRecipes, getPublicRecipes } from "@/lib/recipes/service";
import { RECIPES_DESCRIPTION, RecipeFeed } from "../../_components/recipe-feed";

export const revalidate = 3600;
export const dynamicParams = true;

type Props = { params: Promise<{ n: string }> };

export async function generateStaticParams() {
  return recipePageParams(
    await failOpenAtBuild("recipe page count", countPublicRecipes, 0),
  );
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = parseRecipePage((await params).n);
  if (!page) return { title: "Recipes", robots: { index: false } };
  return pageMetadata(
    `Recipes, page ${page}`,
    RECIPES_DESCRIPTION,
    recipeBrowsePath(page),
  );
}

export default async function RecipesPageN({ params }: Props) {
  const page = parseRecipePage((await params).n);
  if (!page) notFound();
  const { items, hasMore } = await getPublicRecipes(page);
  if (!items.length) notFound();
  return <RecipeFeed page={page} items={items} hasMore={hasMore} />;
}
