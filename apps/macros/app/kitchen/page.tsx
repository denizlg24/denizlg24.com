import Link from "next/link";
import { getUserRecipes } from "@/lib/recipes/service";
import { KitchenGate } from "./_components/gate";
import styles from "./_components/kitchen.module.css";
import { RecipeRows } from "./_components/recipe-rows";
import { SignOut } from "./_components/sign-out";

export const dynamic = "force-dynamic";

export default async function KitchenPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = (await searchParams).tab === "published" ? "published" : "drafts";
  return (
    <KitchenGate>
      {async (session) => {
        const recipes = await getUserRecipes(session.user.id);
        const published = recipes.filter((recipe) => recipe.publishedAt);
        const drafts = recipes.filter((recipe) => !recipe.publishedAt);
        const shown = tab === "published" ? published : drafts;
        return (
          <div className={styles.dashboard}>
            <header className={styles.dashboardBar}>
              <Link href="/recipes" className={styles.brand}>
                Macros Recipes
              </Link>
              <div className={styles.topBarEnd}>
                <SignOut />
                <Link href="/kitchen/new" className={styles.primaryButton}>
                  Write
                </Link>
              </div>
            </header>
            <main className={styles.dashboardMain}>
              <h1 className={styles.dashboardTitle}>Your recipes</h1>
              <nav className={styles.tabs} aria-label="Recipe status">
                <Link
                  href="/kitchen"
                  aria-current={tab === "drafts" ? "page" : undefined}
                >
                  Drafts {drafts.length}
                </Link>
                <Link
                  href="/kitchen?tab=published"
                  aria-current={tab === "published" ? "page" : undefined}
                >
                  Published {published.length}
                </Link>
              </nav>
              {shown.length ? (
                <RecipeRows recipes={shown} />
              ) : (
                <p className={styles.emptyNote}>
                  {tab === "published" ? (
                    "Nothing published yet."
                  ) : (
                    <>
                      No drafts. <Link href="/kitchen/new">Start a recipe</Link>
                      .
                    </>
                  )}
                </p>
              )}
            </main>
          </div>
        );
      }}
    </KitchenGate>
  );
}
