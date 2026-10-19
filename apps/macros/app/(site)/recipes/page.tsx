import { pageMetadata } from "@/app/metadata";
import { failOpenAtBuild } from "@/lib/fail-open";
import { getPublicRecipes } from "@/lib/recipes/service";
import { RECIPES_DESCRIPTION, RecipeFeed } from "./_components/recipe-feed";

export const revalidate = 3600;

export const metadata = pageMetadata(
  "Recipes",
  RECIPES_DESCRIPTION,
  "/recipes",
);

export default async function RecipesPage() {
  const { items, hasMore } = await failOpenAtBuild(
    "recipe feed",
    () => getPublicRecipes(1),
    { items: [], hasMore: false },
  );
  return <RecipeFeed page={1} items={items} hasMore={hasMore} />;
}
