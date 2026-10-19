"use client";

import type { MacrosRecipeSummary } from "@repo/schemas/macros";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import styles from "./kitchen.module.css";

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

function ago(iso: string | undefined) {
  if (!iso) return "";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

export function RecipeRows({
  recipes,
}: {
  recipes: readonly MacrosRecipeSummary[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(id: string) {
    setError(null);
    const response = await fetch(`/api/recipes/${id}`, { method: "DELETE" });
    setConfirming(null);
    if (!response.ok) {
      setError("Couldn’t delete that recipe.");
      return;
    }
    router.refresh();
  }

  return (
    <>
      {error ? (
        <p className={styles.fieldError} role="alert">
          {error}
        </p>
      ) : null}
      <ul className={styles.rows}>
        {recipes.map((recipe) => (
          <li key={recipe.id} className={styles.row}>
            <Link href={`/kitchen/${recipe.id}`} className={styles.rowMain}>
              <h2>{recipe.name}</h2>
              {recipe.description ? <p>{recipe.description}</p> : null}
              <span className={styles.rowMeta}>
                {recipe.publishedAt
                  ? `Published ${ago(recipe.publishedAt)}`
                  : `Edited ${ago(recipe.updatedAt)}`}
                {" · "}
                {recipe.ingredientCount}{" "}
                {recipe.ingredientCount === 1 ? "ingredient" : "ingredients"}
                {" · "}
                {Math.round(recipe.caloriesPerServing)} kcal per serving
              </span>
            </Link>
            {recipe.coverImageUrl ? (
              <img
                className={styles.rowThumb}
                src={recipe.coverImageUrl}
                alt=""
              />
            ) : null}
            <div className={styles.rowActions}>
              <Link href={`/kitchen/${recipe.id}`}>Edit</Link>
              {recipe.publishedAt ? (
                <Link href={`/recipes/${recipe.id}`}>View</Link>
              ) : null}
              {confirming === recipe.id ? (
                <>
                  <button
                    type="button"
                    className={styles.danger}
                    onClick={() => void remove(recipe.id)}
                  >
                    Delete for good
                  </button>
                  <button type="button" onClick={() => setConfirming(null)}>
                    Keep
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirming(recipe.id)}>
                  Delete
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
