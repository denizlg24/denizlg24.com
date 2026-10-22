import {
  inlinesToMarkdown,
  markdownToInlines,
  normalizeBlocks,
  normalizeSteps,
} from "@repo/macros-core/recipe-content";
import type {
  MacrosRecipeBlock,
  MacrosRecipeDetail,
  MacrosRecipeStep,
} from "@repo/schemas/macros";

/**
 * Text fields edit rich text as markdown-lite (**bold**, _italic_,
 * [text](https://…)); a list is one field with an item per line.
 */
export type DraftBlock =
  | { key: string; type: "paragraph" | "quote" | "heading"; text: string }
  | { key: string; type: "list"; ordered: boolean; text: string }
  | {
      key: string;
      type: "image";
      imageKey: string;
      imageUrl: string | null;
      caption: string;
    };

export type DraftBlockType = DraftBlock["type"];

export interface DraftStep {
  key: string;
  title: string;
  blocks: DraftBlock[];
}

export interface RecipeArticleDraft {
  description: string;
  coverImageKey: string | null;
  coverImageUrl: string | null;
  story: DraftBlock[];
  steps: DraftStep[];
  prepMinutes: string;
  cookMinutes: string;
  isPublished: boolean;
}

let sequence = 0;
export function draftKey() {
  sequence += 1;
  return `draft-${sequence}`;
}

export function toDraftBlocks(
  blocks: readonly MacrosRecipeBlock[],
): DraftBlock[] {
  return blocks.map((block): DraftBlock => {
    const key = draftKey();
    switch (block.type) {
      case "paragraph":
      case "quote":
        return {
          key,
          type: block.type,
          text: inlinesToMarkdown(block.content),
        };
      case "heading":
        return { key, type: "heading", text: block.text };
      case "list":
        return {
          key,
          type: "list",
          ordered: block.ordered,
          text: block.items.map(inlinesToMarkdown).join("\n"),
        };
      case "image":
        return {
          key,
          type: "image",
          imageKey: block.imageKey,
          imageUrl: block.imageUrl ?? null,
          caption: block.caption ?? "",
        };
    }
  });
}

export function fromDraftBlocks(
  blocks: readonly DraftBlock[],
): MacrosRecipeBlock[] {
  return normalizeBlocks(
    blocks.map((block): MacrosRecipeBlock => {
      switch (block.type) {
        case "paragraph":
        case "quote":
          return { type: block.type, content: markdownToInlines(block.text) };
        case "heading":
          return { type: "heading", text: block.text };
        case "list":
          return {
            type: "list",
            ordered: block.ordered,
            items: block.text
              .split("\n")
              .map((line) =>
                markdownToInlines(line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")),
              ),
          };
        case "image":
          return {
            type: "image",
            imageKey: block.imageKey,
            caption: block.caption,
          };
      }
    }),
  );
}

export function emptyBlock(type: Exclude<DraftBlockType, "image">): DraftBlock {
  return type === "list"
    ? { key: draftKey(), type, ordered: false, text: "" }
    : { key: draftKey(), type, text: "" };
}

function minutesText(value: number | null | undefined) {
  return value ? String(value) : "";
}

export function articleFromRecipe(
  recipe: MacrosRecipeDetail | undefined,
): RecipeArticleDraft {
  return {
    description: recipe?.description ?? "",
    coverImageKey: recipe?.coverImageKey ?? null,
    coverImageUrl: recipe?.coverImageUrl ?? null,
    story: toDraftBlocks(recipe?.story ?? []),
    steps: (recipe?.steps ?? []).map((step) => ({
      key: draftKey(),
      title: step.title,
      blocks: toDraftBlocks(step.blocks),
    })),
    prepMinutes: minutesText(recipe?.prepTimeMinutes),
    cookMinutes: minutesText(recipe?.cookTimeMinutes),
    isPublished: Boolean(recipe?.publicUrl),
  };
}

function minutesOrNull(text: string) {
  const value = Number(text.trim());
  return text.trim() && Number.isInteger(value) && value >= 0 && value <= 10_000
    ? value
    : null;
}

export function minutesValid(text: string) {
  return !text.trim() || minutesOrNull(text) !== null;
}

/** The request fields; also what the dirty check compares. */
export function articleBody(draft: RecipeArticleDraft) {
  const steps: MacrosRecipeStep[] = normalizeSteps(
    draft.steps.map((step) => ({
      title: step.title,
      blocks: fromDraftBlocks(step.blocks),
    })),
  );
  return {
    description: draft.description.trim() || null,
    coverImageKey: draft.coverImageKey,
    story: fromDraftBlocks(draft.story),
    steps,
    prepTimeMinutes: minutesOrNull(draft.prepMinutes),
    cookTimeMinutes: minutesOrNull(draft.cookMinutes),
    isPublished: draft.isPublished,
  };
}
