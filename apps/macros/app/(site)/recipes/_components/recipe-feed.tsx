import Link from "next/link";
import { serif } from "@/app/_recipes/fonts";
import { formatMinutes } from "@/app/_recipes/recipe-article";
import { recipeBrowsePath } from "@/lib/recipes/pagination";
import type { PublicRecipeSummary } from "@/lib/recipes/service";
import styles from "../browse.module.css";

export const RECIPES_DESCRIPTION =
  "Recipes written in Macros, with ingredients, illustrated steps and nutrition per serving.";

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});

export function RecipeFeed({
  page,
  items,
  hasMore,
}: {
  page: number;
  items: readonly PublicRecipeSummary[];
  hasMore: boolean;
}) {
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
          Nothing published yet.{" "}
          <Link href="/kitchen/new">Write the first one</Link>.
        </p>
      )}
      <nav className={styles.pagination} aria-label="Recipe pages">
        <span>
          {page > 1 ? (
            <Link href={recipeBrowsePath(page - 1)}>← Newer</Link>
          ) : null}
        </span>
        <span>
          {hasMore ? (
            <Link href={recipeBrowsePath(page + 1)}>Older →</Link>
          ) : null}
        </span>
      </nav>
    </div>
  );
}
