import { revalidatePath } from "next/cache";
import { recipeShareImagePath } from "./share-image";

type PathTarget = { path: string; type?: "page" | "layout" };

export function publicRecipePaths(recipeIds: readonly string[]): PathTarget[] {
  return [
    ...[...new Set(recipeIds)].flatMap((id) => [
      { path: `/recipes/${id}` },
      { path: recipeShareImagePath(id) },
    ]),
    { path: "/recipes" },
    { path: "/(site)/recipes/page/[n]", type: "page" },
    { path: "/sitemap.xml" },
  ];
}

/**
 * Call after the write has committed. Inside a route handler this only queues
 * the invalidation, which Next applies once the handler returns. Outside a
 * request (a script, a test) there is nothing to invalidate and Next throws;
 * the write already succeeded, so that is logged rather than surfaced.
 */
export function revalidatePublicRecipes(recipeIds: readonly string[]) {
  if (!recipeIds.length) return;
  try {
    for (const { path, type } of publicRecipePaths(recipeIds))
      revalidatePath(path, type);
  } catch (error) {
    console.warn(
      `[macros] could not revalidate public recipe pages for ${recipeIds.join(", ")}:`,
      error instanceof Error ? error.message : error,
    );
  }
}
