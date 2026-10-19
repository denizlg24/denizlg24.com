export const PUBLIC_RECIPES_PAGE_SIZE = 24;

export function recipePageCount(total: number) {
  return Math.max(1, Math.ceil(total / PUBLIC_RECIPES_PAGE_SIZE));
}

export function recipeBrowsePath(page: number) {
  return page <= 1 ? "/recipes" : `/recipes/page/${page}`;
}

/** Page 1 lives at `/recipes`, so `/recipes/page/[n]` only owns n ≥ 2. */
export function parseRecipePage(raw: string) {
  if (!/^[1-9]\d{0,4}$/.test(raw)) return null;
  const page = Number(raw);
  return page >= 2 ? page : null;
}

export function recipePageParams(total: number) {
  return Array.from({ length: recipePageCount(total) - 1 }, (_, index) => ({
    n: String(index + 2),
  }));
}
