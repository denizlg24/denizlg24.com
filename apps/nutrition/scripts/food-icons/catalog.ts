import { readFile } from "node:fs/promises";

import type { FoodIconRules } from "../../src/modules/food-icons/classifier";

export interface IconCatalogEntry {
  key: string;
  terms: string[];
}

/**
 * Combine artwork captions with curated matching rules, stripping each regex
 * back to the plain words it describes for the classification catalog.
 */
const patternToTerms = (pattern: string) =>
  pattern
    .replace(/\(\?:/g, "(")
    .replace(/\\b/g, "")
    .replace(/[\\^$*+?()[\]{}|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Captions cover every original illustration, including those with no rule.
 */
const CAPTIONS_PATH = "config/food-icons/captions.json";

export const buildIconCatalog = async (
  rulesPath: string,
): Promise<IconCatalogEntry[]> => {
  const config = JSON.parse(await readFile(rulesPath, "utf8")) as FoodIconRules;
  const captions = JSON.parse(await readFile(CAPTIONS_PATH, "utf8")) as Record<
    string,
    string
  >;
  const byKey = new Map<string, Set<string>>();

  for (const [key, caption] of Object.entries(captions)) {
    byKey.set(key, new Set([caption]));
  }

  for (const rule of config.rules) {
    const terms = byKey.get(rule.iconKey) ?? new Set<string>();
    for (const pattern of rule.patterns) {
      const term = patternToTerms(pattern);
      if (term) terms.add(term);
    }
    byKey.set(rule.iconKey, terms);
  }

  return [...byKey.entries()]
    .map(([key, terms]) => ({ key, terms: [...terms].slice(0, 8) }))
    .sort((a, b) => a.key.localeCompare(b.key));
};

export const renderCatalog = (entries: IconCatalogEntry[]) =>
  entries.map((entry) => `${entry.key} = ${entry.terms.join(", ")}`).join("\n");
