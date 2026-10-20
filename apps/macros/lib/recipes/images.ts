import { recipeImageKeys } from "@repo/macros-core/recipe-content";
import type { MacrosRecipeBlock, MacrosRecipeStep } from "@repo/schemas/macros";
import { inspectBodyPhoto } from "@/lib/body/storage";

export const RECIPE_IMAGE_MAX_BYTES = 3_000_000;

type Article = {
  coverImageKey?: string | null;
  story?: readonly MacrosRecipeBlock[];
  steps?: readonly MacrosRecipeStep[];
};

export function recipeImageUrl(recipeId: string, key: string | null) {
  if (!key) return null;
  const imageId = key.split("/").at(-1);
  return `/api/recipes/${recipeId}/images/${imageId}`;
}

export function ownsRecipeImage(userId: string, key: string) {
  return (
    key.startsWith(`users/${userId}/recipes/`) &&
    /^[0-9a-f-]{36}\.jpg$/.test(key.slice(`users/${userId}/recipes/`.length))
  );
}

/** JPEG starts FF D8 FF whatever its encoder; nothing else is accepted. */
export function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export function withImageUrls<T extends Article>(recipeId: string, article: T) {
  const blocks = (blocks: readonly MacrosRecipeBlock[]) =>
    blocks.map((block) =>
      block.type === "image"
        ? { ...block, imageUrl: recipeImageUrl(recipeId, block.imageKey) }
        : block,
    );
  return {
    story: blocks(article.story ?? []),
    steps: (article.steps ?? []).map((step) => ({
      ...step,
      blocks: blocks(step.blocks),
    })),
  };
}

export async function validateRecipeImages(
  userId: string,
  article: Article,
  inspect = inspectBodyPhoto,
) {
  // The storage service can reject simultaneous metadata requests on one client.
  // Check photos in order so a multi-photo article can be saved reliably.
  for (const key of recipeImageKeys(article)) {
    if (!ownsRecipeImage(userId, key))
      throw new Error("This recipe image does not belong to your account.");
    const object = await inspect(key).catch((cause: unknown) => {
      console.error("[macros] recipe photo validation failed", cause);
      throw new Error(
        "Couldn’t verify a recipe photo. Your edits are still here. Try saving again.",
        { cause },
      );
    });
    if (
      object.ContentType !== "image/jpeg" ||
      !object.ContentLength ||
      object.ContentLength > RECIPE_IMAGE_MAX_BYTES
    ) {
      throw new Error(
        "Recipe images must be JPEG photos under 3 MB. Choose the photo again.",
      );
    }
  }
}
