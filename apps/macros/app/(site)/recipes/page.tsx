import type { Metadata } from "next";
import Link from "next/link";
import { serif } from "@/app/_recipes/fonts";
import { formatMinutes } from "@/app/_recipes/recipe-article";
import { getPublicRecipes } from "@/lib/recipes/service";
import styles from "./browse.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Recipes",
  description:
    "Recipes written in Macros, with ingredients, illustrated steps and nutrition per serving.",
};

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

export default async function RecipesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const raw = Number((await searchParams).page ?? 1);
  const page = Number.isSafeInteger(raw) && raw > 0 && raw <= 10000 ? raw : 1;
  const { items, hasMore } = await getPublicRecipes(page);
  return (
    <div className={`${styles.browse} ${serif.variable}`}>
      <header className={styles.header}>
        <h1>Recipes</h1>
        <Link className={styles.write} href="/kitchen/new">
          Write a recipe
        </Link>
      </header>
      {items.length ? (
        <ol className={styles.feed}>
          {items.map((recipe) => (
            <li key={recipe.id} className={styles.item}>
              <Link className={styles.link} href={`/recipes/${recipe.id}`}>
                <div>
                  <h2 className={styles.title}>{recipe.name}</h2>
                  {recipe.description ? (
                    <p className={styles.excerpt}>{recipe.description}</p>
                  ) : null}
                  <p className={styles.meta}>
                    {[
                      recipe.publishedAt
                        ? dateFormat.format(recipe.publishedAt)
                        : null,
                      recipe.totalMinutes
                        ? formatMinutes(recipe.totalMinutes)
                        : null,
                      `${recipe.servings} ${recipe.servings === 1 ? "serving" : "servings"}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {recipe.coverImageUrl ? (
                  <img
                    className={styles.thumb}
                    src={recipe.coverImageUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                ) : null}
              </Link>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>
          {page > 1 ? (
            <Link href="/recipes">Back to the latest recipes</Link>
          ) : (
            <>
              Nothing published yet.{" "}
              <Link href="/kitchen/new">Write the first one</Link>.
            </>
          )}
        </p>
      )}
      <nav className={styles.pagination} aria-label="Recipe pages">
        <span>
          {page > 1 ? (
            <Link href={`/recipes?page=${page - 1}`}>← Newer</Link>
          ) : null}
        </span>
        <span>
          {hasMore ? (
            <Link href={`/recipes?page=${page + 1}`}>Older →</Link>
          ) : null}
        </span>
      </nav>
    </div>
  );
}
