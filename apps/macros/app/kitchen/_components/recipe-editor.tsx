"use client";

import {
  hasWrittenStep,
  normalizeBlocks,
  normalizeSteps,
} from "@repo/macros-core/recipe-content";
import {
  type MacrosRecipeBlock,
  type MacrosRecipeDetail,
  type MacrosRecipeIngredientDetail,
  macrosCreateRecipeResponseSchema,
  macrosRecipeDetailResponseSchema,
} from "@repo/schemas/macros";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { serif } from "@/app/_recipes/fonts";
import { RecipeArticle } from "@/app/_recipes/recipe-article";
import { ShareButton } from "@/app/_recipes/share-button";
import {
  type DraftIngredient,
  IngredientList,
  nextKey,
  totalsOf,
} from "./ingredients";
import styles from "./kitchen.module.css";
import { RichEditor } from "./rich-editor";
import { pickImage, uploadRecipeImage } from "./upload";

type DraftStep = { key: string; title: string; blocks: MacrosRecipeBlock[] };
type Cover = { key: string; url: string | null } | null;

function fromDetail(rows: readonly MacrosRecipeIngredientDetail[]) {
  return rows.map(
    (row): DraftIngredient => ({
      key: nextKey(),
      ingredientId: row.id,
      sourceItemId: row.sourceItemId ?? null,
      name: row.foodName,
      brand: row.brand,
      servings: row.servings,
      perServing: {
        calories: row.servings ? row.caloriesContribution / row.servings : 0,
        protein: row.servings ? row.proteinContribution / row.servings : 0,
        carbs: row.servings ? row.carbsContribution / row.servings : 0,
        fat: row.servings ? row.fatContribution / row.servings : 0,
      },
      amountLabel: row.amountLabel ?? `${row.servings} × serving`,
    }),
  );
}

function numberOrNull(text: string) {
  if (!text.trim()) return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) ? value : Number.NaN;
}

function minutesOrNull(text: string) {
  const value = numberOrNull(text);
  return value === null || Number.isNaN(value) ? value : Math.round(value);
}

async function errorMessage(response: Response) {
  const json: unknown = await response.json().catch(() => null);
  if (json && typeof json === "object") {
    if ("issues" in json && Array.isArray(json.issues) && json.issues[0]) {
      const issue: unknown = json.issues[0];
      if (issue && typeof issue === "object" && "message" in issue)
        return String(issue.message);
    }
    if ("error" in json) return String(json.error);
  }
  return response.status === 401
    ? "You were signed out. Sign in again in another tab, then save."
    : "Couldn’t save the recipe.";
}

let stepSequence = 0;
function stepKey() {
  stepSequence += 1;
  return `step-${stepSequence}`;
}

export function RecipeEditor({
  initial,
}: {
  initial: MacrosRecipeDetail | null;
}) {
  const router = useRouter();
  const [recipeId, setRecipeId] = useState(initial?.id ?? null);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cover, setCover] = useState<Cover>(
    initial?.coverImageKey
      ? { key: initial.coverImageKey, url: initial.coverImageUrl ?? null }
      : null,
  );
  const [story, setStory] = useState<MacrosRecipeBlock[]>(initial?.story ?? []);
  const [steps, setSteps] = useState<DraftStep[]>(() =>
    (initial?.steps?.length ? initial.steps : [{ title: "", blocks: [] }]).map(
      (step) => ({ ...step, key: stepKey() }),
    ),
  );
  const [ingredients, setIngredients] = useState<DraftIngredient[]>(() =>
    fromDetail(initial?.ingredients ?? []),
  );
  const [ingredientsTouched, setIngredientsTouched] = useState(false);
  const [servings, setServings] = useState(String(initial?.servings ?? 2));
  const [weight, setWeight] = useState(
    initial ? String(Math.round(initial.totalWeightGrams)) : "",
  );
  const [prep, setPrep] = useState(
    initial?.prepTimeMinutes ? String(initial.prepTimeMinutes) : "",
  );
  const [cook, setCook] = useState(
    initial?.cookTimeMinutes ? String(initial.cookTimeMinutes) : "",
  );
  const [publishedAt, setPublishedAt] = useState(initial?.publishedAt ?? null);
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "uploading"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  const servingsValue = numberOrNull(servings);
  const weightValue = numberOrNull(weight);
  const prepValue = minutesOrNull(prep);
  const cookValue = minutesOrNull(cook);

  const article = useMemo(
    () => ({
      name: name.trim(),
      description: description.trim() || null,
      coverImageKey: cover?.key ?? null,
      story,
      steps: steps.map(({ title, blocks }) => ({ title, blocks })),
      prepTimeMinutes: prepValue,
      cookTimeMinutes: cookValue,
      servings: servingsValue,
      totalWeightGrams: weightValue,
    }),
    [
      name,
      description,
      cover,
      story,
      steps,
      prepValue,
      cookValue,
      servingsValue,
      weightValue,
    ],
  );
  const fingerprintWith = (rows: readonly DraftIngredient[]) =>
    JSON.stringify([
      article.name,
      article.description,
      article.coverImageKey,
      normalizeBlocks(story),
      normalizeSteps(article.steps),
      prepValue,
      cookValue,
      servingsValue,
      weightValue,
      rows.map((row) => [row.sourceItemId, row.servings]),
    ]);
  const fingerprint = fingerprintWith(ingredients);
  const [savedFingerprint, setSavedFingerprint] = useState(() =>
    initial ? fingerprint : "",
  );
  const dirty = fingerprint !== savedFingerprint;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    if (!initial) titleRef.current?.focus();
  }, [initial]);

  function problems(publish: boolean) {
    if (!article.name) return "Give the recipe a title.";
    if (!ingredients.length) return "Add at least one ingredient.";
    if (servingsValue === null || !(servingsValue > 0) || servingsValue > 9999)
      return "Servings must be a number above zero.";
    if (weightValue === null || !(weightValue > 0))
      return "Enter the cooked weight of the whole dish in grams.";
    if (Number.isNaN(prepValue) || Number.isNaN(cookValue))
      return "Times are whole minutes.";
    if (publish && !hasWrittenStep(article.steps))
      return "Write at least one step before publishing.";
    return null;
  }

  async function save(publish: boolean) {
    const problem = problems(publish);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setStatus("saving");
    const body = {
      ...article,
      isPublished: publish,
      ...(recipeId && !ingredientsTouched
        ? {}
        : {
            ingredients: ingredients.map((row) =>
              row.ingredientId && recipeId
                ? {
                    ingredientId: row.ingredientId,
                    servingsConsumed: row.servings,
                  }
                : {
                    sourceItemId: row.sourceItemId,
                    servingsConsumed: row.servings,
                  },
            ),
          }),
    };
    try {
      const response = await fetch(
        recipeId ? `/api/recipes/${recipeId}` : "/api/recipes",
        {
          method: recipeId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        setError(await errorMessage(response));
        setStatus("idle");
        return;
      }
      const { recipe } = macrosCreateRecipeResponseSchema.parse(
        await response.json(),
      );
      setPublishedAt(recipe.publishedAt ?? null);
      if (!recipeId) {
        setSavedFingerprint(fingerprint);
        setRecipeId(recipe.id);
        router.replace(`/kitchen/${recipe.id}`);
        return;
      }
      if (ingredientsTouched) {
        const detail = await fetch(`/api/recipes/${recipe.id}`);
        if (detail.ok) {
          const parsed = macrosRecipeDetailResponseSchema.parse(
            await detail.json(),
          );
          const fresh = fromDetail(parsed.recipe.ingredients);
          setIngredients(fresh);
          setIngredientsTouched(false);
          setSavedFingerprint(fingerprintWith(fresh));
        } else {
          router.refresh();
        }
      } else {
        setSavedFingerprint(fingerprint);
      }
      setStatus("saved");
    } catch {
      setError("Couldn’t reach the server. Your edits are still here.");
      setStatus("idle");
    }
  }

  async function chooseCover() {
    const file = await pickImage();
    if (!file) return;
    setStatus("uploading");
    setError(null);
    try {
      const uploaded = await uploadRecipeImage(file);
      setCover({ key: uploaded.storageKey, url: uploaded.previewUrl });
    } catch (uploadError) {
      setError(
        uploadError instanceof Error ? uploadError.message : "Upload failed.",
      );
    } finally {
      setStatus("idle");
    }
  }

  const published = Boolean(publishedAt);
  const totals = totalsOf(ingredients);
  const perServing = servingsValue && servingsValue > 0 ? servingsValue : 1;

  const previewDetail: MacrosRecipeDetail = {
    id: recipeId ?? "00000000-0000-4000-8000-000000000000",
    name: article.name || "Untitled recipe",
    description: article.description,
    iconKey: null,
    servingLabel: "serving",
    servings: perServing,
    totalWeightGrams: weightValue && weightValue > 0 ? weightValue : 0,
    caloriesPerServing: totals.calories / perServing,
    proteinPerServing: totals.protein / perServing,
    carbsPerServing: totals.carbs / perServing,
    fatPerServing: totals.fat / perServing,
    ingredientCount: ingredients.length,
    createdAt: initial?.createdAt ?? new Date().toISOString(),
    publishedAt,
    coverImageUrl: cover?.url ?? null,
    story: normalizeBlocks(story).map((block) =>
      block.type === "image"
        ? { ...block, imageUrl: imageUrlFor(story, block.imageKey) }
        : block,
    ),
    steps: steps
      .map((step) => ({
        title: step.title.trim(),
        blocks: normalizeBlocks(step.blocks).map((block) =>
          block.type === "image"
            ? { ...block, imageUrl: imageUrlFor(step.blocks, block.imageKey) }
            : block,
        ),
      }))
      .filter((step) => step.title || step.blocks.length),
    prepTimeMinutes: Number.isNaN(prepValue) ? null : prepValue,
    cookTimeMinutes: Number.isNaN(cookValue) ? null : cookValue,
    nutrientsPerServing: {},
    ingredients: ingredients.map((row) => ({
      id: row.key,
      foodName: row.name,
      brand: row.brand,
      servings: row.servings,
      amountLabel: row.amountLabel,
      caloriesContribution: row.perServing.calories * row.servings,
      proteinContribution: row.perServing.protein * row.servings,
      carbsContribution: row.perServing.carbs * row.servings,
      fatContribution: row.perServing.fat * row.servings,
    })),
  };

  const saveLabel =
    status === "saving"
      ? "Saving…"
      : status === "uploading"
        ? "Uploading…"
        : dirty
          ? recipeId
            ? "Unsaved changes"
            : "Not saved yet"
          : status === "saved"
            ? "Saved"
            : null;

  return (
    <div className={`${styles.editorPage} ${serif.variable}`}>
      <header className={styles.topBar}>
        <div className={styles.topBarStart}>
          <Link href="/kitchen" className={styles.brand}>
            Kitchen
          </Link>
          <span className={styles.status}>
            {published ? "Published" : "Draft"}
            {saveLabel ? ` · ${saveLabel}` : ""}
          </span>
        </div>
        <div className={styles.topBarEnd}>
          {published && recipeId ? (
            <ShareButton
              title={name}
              url={`/recipes/${recipeId}`}
              className={styles.ghostButton}
            />
          ) : null}
          {published && recipeId ? (
            <Link
              className={styles.ghostButton}
              href={`/recipes/${recipeId}`}
              target="_blank"
            >
              View
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.ghostButton}
            aria-pressed={preview}
            onClick={() => setPreview((value) => !value)}
          >
            {preview ? "Edit" : "Preview"}
          </button>
          {published ? (
            <button
              type="button"
              className={styles.ghostButton}
              disabled={status === "saving"}
              onClick={() => void save(false)}
            >
              Unpublish
            </button>
          ) : (
            <button
              type="button"
              className={styles.ghostButton}
              disabled={status === "saving"}
              onClick={() => void save(false)}
            >
              Save draft
            </button>
          )}
          <button
            type="button"
            className={styles.primaryButton}
            disabled={status === "saving" || (published && !dirty)}
            onClick={() => void save(true)}
          >
            {published ? "Update" : "Publish"}
          </button>
        </div>
      </header>

      {error ? (
        <p className={styles.errorBar} role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </p>
      ) : null}

      {preview ? (
        <RecipeArticle recipe={previewDetail} footer={<span />} />
      ) : (
        <main className={styles.canvas}>
          <div className={styles.coverSlot}>
            {cover?.url ? (
              <figure className={styles.coverFigure}>
                <img src={cover.url} alt="" />
                <div className={styles.coverTools}>
                  <button type="button" onClick={() => void chooseCover()}>
                    Replace
                  </button>
                  <button type="button" onClick={() => setCover(null)}>
                    Remove
                  </button>
                </div>
              </figure>
            ) : (
              <button
                type="button"
                className={styles.quietButton}
                onClick={() => void chooseCover()}
              >
                + Cover photo
              </button>
            )}
          </div>

          <textarea
            ref={titleRef}
            className={styles.titleInput}
            rows={1}
            maxLength={160}
            placeholder="Title"
            aria-label="Title"
            value={name}
            onChange={(event) => setName(event.target.value.replace(/\n/g, ""))}
          />
          <textarea
            className={styles.subtitleInput}
            rows={1}
            maxLength={600}
            placeholder="A line about the dish"
            aria-label="Subtitle"
            value={description}
            onChange={(event) =>
              setDescription(event.target.value.replace(/\n/g, " "))
            }
          />

          <RichEditor
            initial={initial?.story ?? []}
            onChange={setStory}
            placeholder="Tell its story…"
            label="Story"
            onError={setError}
          />

          <section className={styles.block} aria-labelledby="details-title">
            <h2 id="details-title" className={styles.blockTitle}>
              Details
            </h2>
            <div className={styles.details}>
              <label>
                <span>Servings</span>
                <input
                  inputMode="decimal"
                  value={servings}
                  onChange={(event) => setServings(event.target.value)}
                />
              </label>
              <label>
                <span>Cooked weight</span>
                <span className={styles.withUnit}>
                  <input
                    inputMode="decimal"
                    placeholder="0"
                    value={weight}
                    onChange={(event) => setWeight(event.target.value)}
                  />
                  g
                </span>
              </label>
              <label>
                <span>Prep</span>
                <span className={styles.withUnit}>
                  <input
                    inputMode="numeric"
                    placeholder="–"
                    value={prep}
                    onChange={(event) => setPrep(event.target.value)}
                  />
                  min
                </span>
              </label>
              <label>
                <span>Cook</span>
                <span className={styles.withUnit}>
                  <input
                    inputMode="numeric"
                    placeholder="–"
                    value={cook}
                    onChange={(event) => setCook(event.target.value)}
                  />
                  min
                </span>
              </label>
            </div>
          </section>

          <section className={styles.block} aria-labelledby="ingredients-title">
            <div className={styles.blockHeader}>
              <h2 id="ingredients-title" className={styles.blockTitle}>
                Ingredients
              </h2>
              <p className={styles.totals}>
                Per serving{" "}
                <strong>{Math.round(totals.calories / perServing)} kcal</strong>{" "}
                · P {Math.round(totals.protein / perServing)} · C{" "}
                {Math.round(totals.carbs / perServing)} · F{" "}
                {Math.round(totals.fat / perServing)}
              </p>
            </div>
            <IngredientList
              ingredients={ingredients}
              onChange={(next) => {
                setIngredients(next);
                setIngredientsTouched(true);
              }}
            />
          </section>

          <section className={styles.block} aria-labelledby="method-title">
            <h2 id="method-title" className={styles.blockTitle}>
              Method
            </h2>
            <ol className={styles.stepList}>
              {steps.map((step, index) => (
                <li key={step.key} className={styles.stepItem}>
                  <div className={styles.stepHead}>
                    <span className={styles.stepNumber}>Step {index + 1}</span>
                    <div className={styles.rowTools}>
                      <button
                        type="button"
                        aria-label={`Move step ${index + 1} up`}
                        disabled={index === 0}
                        onClick={() =>
                          setSteps((current) => swap(current, index, -1))
                        }
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        aria-label={`Move step ${index + 1} down`}
                        disabled={index === steps.length - 1}
                        onClick={() =>
                          setSteps((current) => swap(current, index, 1))
                        }
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete step ${index + 1}`}
                        disabled={steps.length === 1}
                        onClick={() =>
                          setSteps((current) =>
                            current.filter((row) => row.key !== step.key),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </div>
                  <input
                    className={styles.stepTitleInput}
                    maxLength={160}
                    placeholder="Step title"
                    aria-label={`Step ${index + 1} title`}
                    value={step.title}
                    onChange={(event) =>
                      setSteps((current) =>
                        current.map((row) =>
                          row.key === step.key
                            ? { ...row, title: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <RichEditor
                    initial={step.blocks}
                    onChange={(blocks) =>
                      setSteps((current) =>
                        current.map((row) =>
                          row.key === step.key ? { ...row, blocks } : row,
                        ),
                      )
                    }
                    placeholder="What happens in this step…"
                    label={`Step ${index + 1}`}
                    onError={setError}
                  />
                </li>
              ))}
            </ol>
            <button
              type="button"
              className={styles.quietButton}
              disabled={steps.length >= 60}
              onClick={() =>
                setSteps((current) => [
                  ...current,
                  { key: stepKey(), title: "", blocks: [] },
                ])
              }
            >
              + Add step
            </button>
          </section>
        </main>
      )}
    </div>
  );
}

function swap<T>(rows: readonly T[], index: number, offset: -1 | 1) {
  const next = [...rows];
  const [moving] = next.splice(index, 1);
  if (moving === undefined) return next;
  next.splice(index + offset, 0, moving);
  return next;
}

function imageUrlFor(blocks: readonly MacrosRecipeBlock[], imageKey: string) {
  const block = blocks.find(
    (candidate) =>
      candidate.type === "image" && candidate.imageKey === imageKey,
  );
  return block?.type === "image" ? (block.imageUrl ?? null) : null;
}
