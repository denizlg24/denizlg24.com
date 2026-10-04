const QUANTITY =
  /\b\d+(?:[.,]\d+)?\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(?:kg|g|gr|grs|mg|ml|cl|dl|l|lt|ltr|oz|fl\.?\s?oz|lbs?|ct|count|pk|pack|pcs?|un|uds?|stk)\b\.?/g;

const PACKAGING =
  /\b(?:carton|bottle|bottles|can|cans|tub|bag|box|jar|pouch|tray|pack|packet|multipack|microwavable|bowl|sachet|tin|garrafa|lata|frasco|embalagem|pacote|bouteille|boite|canette|flasche|dose|packung)\b/g;

export const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "");

/** Brand identity: the first listed brand, folded, without a leading "the". */
export const brandKey = (brand: string | null) => {
  if (!brand) return "";
  const first = brand.split(",")[0] ?? "";
  return fold(first)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/^the /, "")
    .trim();
};

/**
 * Product identity from a name: pack sizes, packaging words and the brand
 * itself are noise ("Campbell's Chicken Soup 15.5 oz Tub" and "Chicken Soup"
 * from Campbell's are the same food).
 */
export const nameKey = (name: string, brand: string | null) => {
  let key = fold(name).replace(QUANTITY, " ").replace(PACKAGING, " ");
  const brandText = brandKey(brand);
  if (brandText)
    key = ` ${key.replace(/[^\p{L}\p{N}%]+/gu, " ")} `.replace(
      ` ${brandText} `,
      " ",
    );
  return key
    .replace(/[^\p{L}\p{N}%]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
};

export interface Macros {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const close = (a: number, b: number, absolute: number, relative: number) =>
  Math.abs(a - b) <= Math.max(absolute, relative * Math.max(a, b));

/**
 * Two label panels describe the same product when every macro agrees within
 * label rounding: about 10 kcal or 7% for energy, 1 g or 10% for the rest.
 */
export const sameNutrition = (a: Macros, b: Macros) =>
  close(a.calories, b.calories, 10, 0.07) &&
  close(a.protein, b.protein, 1, 0.1) &&
  close(a.carbs, b.carbs, 1, 0.1) &&
  close(a.fat, b.fat, 1, 0.1);

/** Short, stable key for a name group; FNV-1a is enough for bucketing. */
export const groupHash = (text: string) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
};
