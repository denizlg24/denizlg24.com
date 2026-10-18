import { readingMinutes } from "@repo/macros-core/recipe-content";
import type { MacrosRecipeDetail } from "@repo/schemas/macros";
import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./article.module.css";
import { serif } from "./fonts";
import { RecipeBlocks } from "./recipe-blocks";

const dateFormat = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <li>
      {label} <strong>{value}</strong>
    </li>
  );
}

export function RecipeArticle({
  recipe,
  actions,
  footer,
}: {
  recipe: MacrosRecipeDetail;
  actions?: ReactNode;
  footer?: ReactNode;
}) {
  const story = recipe.story ?? [];
  const steps = recipe.steps ?? [];
  const minutes = readingMinutes({
    description: recipe.description,
    story,
    steps,
  });
  const published = recipe.publishedAt ? new Date(recipe.publishedAt) : null;
  const prep = recipe.prepTimeMinutes ?? 0;
  const cook = recipe.cookTimeMinutes ?? 0;

  return (
    <article className={`${styles.article} ${serif.variable}`}>
      <header className={styles.column}>
        <h1 className={styles.title}>{recipe.name}</h1>
        {recipe.description ? (
          <p className={styles.subtitle}>{recipe.description}</p>
        ) : null}
        <div className={styles.byline}>
          <p>
            <span className={styles.bylineName}>Macros Recipes</span>
          </p>
          <p>
            {minutes} min read
            {published ? (
              <>
                {" · "}
                <time dateTime={published.toISOString()}>
                  {dateFormat.format(published)}
                </time>
              </>
            ) : null}
          </p>
        </div>
        <div className={styles.actions}>
          <ul className={styles.facts}>
            <Fact
              label={recipe.servings === 1 ? "Serving" : "Servings"}
              value={String(recipe.servings)}
            />
            {prep ? <Fact label="Prep" value={formatMinutes(prep)} /> : null}
            {cook ? <Fact label="Cook" value={formatMinutes(cook)} /> : null}
            <Fact
              label="Per serving"
              value={`${Math.round(recipe.caloriesPerServing)} kcal`}
            />
          </ul>
          <div className={styles.actionLinks}>
            <a className={styles.textButton} href="#ingredients">
              Jump to recipe
            </a>
            {actions}
          </div>
        </div>
      </header>

      {recipe.coverImageUrl ? (
        <figure className={`${styles.wide} ${styles.cover}`}>
          <img
            src={recipe.coverImageUrl}
            alt={recipe.name}
            fetchPriority="high"
          />
        </figure>
      ) : null}

      <div className={`${styles.column} ${styles.body}`}>
        {story.length ? (
          <div className={styles.story}>
            <RecipeBlocks blocks={story} fallbackAlt={recipe.name} />
          </div>
        ) : null}

        <section
          id="ingredients"
          className={styles.section}
          aria-labelledby="ingredients-title"
        >
          <h2 id="ingredients-title" className={styles.sectionTitle}>
            Ingredients
          </h2>
          <p className={styles.sectionNote}>
            For {recipe.servings}{" "}
            {recipe.servings === 1 ? "serving" : "servings"} ·{" "}
            {Math.round(recipe.totalWeightGrams)} g cooked
          </p>
          <ul className={styles.ingredients}>
            {recipe.ingredients.map((ingredient) => (
              <li key={ingredient.id}>
                <span>
                  {ingredient.foodName}
                  {ingredient.brand ? (
                    <span className={styles.ingredientBrand}>
                      {ingredient.brand}
                    </span>
                  ) : null}
                </span>
                <span className={styles.amount}>
                  {ingredient.amountLabel ??
                    `${Number(ingredient.servings.toFixed(2))} × serving`}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {steps.length ? (
          <section
            id="method"
            className={styles.section}
            aria-labelledby="method-title"
          >
            <h2 id="method-title" className={styles.sectionTitle}>
              Method
            </h2>
            <ol className={styles.steps}>
              {steps.map((step, index) => (
                <li key={`${index}-${step.title}`} className={styles.step}>
                  <p className={styles.stepLabel}>Step {index + 1}</p>
                  {step.title ? (
                    <h3 className={styles.stepTitle}>{step.title}</h3>
                  ) : null}
                  <div className={styles.stepBody}>
                    <RecipeBlocks
                      blocks={step.blocks}
                      headingLevel={4}
                      fallbackAlt={step.title || `Step ${index + 1}`}
                    />
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section className={styles.section} aria-labelledby="nutrition-title">
          <h2 id="nutrition-title" className={styles.sectionTitle}>
            Per serving
          </h2>
          <dl className={styles.nutrition}>
            {(
              [
                ["Energy", recipe.caloriesPerServing, "kcal"],
                ["Protein", recipe.proteinPerServing, "g"],
                ["Carbs", recipe.carbsPerServing, "g"],
                ["Fat", recipe.fatPerServing, "g"],
              ] as const
            ).map(([label, value, unit]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>
                  {Math.round(value)}
                  <small>{unit}</small>
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {footer ?? (
          <footer className={styles.footer}>
            <p>Written with Macros.</p>
            <div className={styles.footerLinks}>
              <Link href="/recipes">More recipes</Link>
              <Link href="/kitchen">Write a recipe</Link>
            </div>
          </footer>
        )}
      </div>
    </article>
  );
}
