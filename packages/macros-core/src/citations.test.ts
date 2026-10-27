import { describe, expect, test } from "bun:test";
import { CITATION_TOPICS, CITATIONS } from "./citations";
import { ACTIVITY_MULTIPLIERS, PROTEIN_PROFILES } from "./wizard/calc";

function topic(key: string) {
  const found = CITATION_TOPICS.find((entry) => entry.key === key);
  if (!found) throw new Error(`missing topic ${key}`);
  return found;
}

describe("citations", () => {
  test("every citation is keyed by its id, linked over https and cited", () => {
    const cited = new Set(CITATION_TOPICS.flatMap((entry) => entry.citations));
    for (const [key, citation] of Object.entries(CITATIONS)) {
      expect(citation.id).toBe(key as typeof citation.id);
      expect(citation.url.startsWith("https://")).toBe(true);
      expect(cited.has(citation.id)).toBe(true);
    }
  });

  test("the energy summary states the activity multipliers in use", () => {
    const factors = Object.values(ACTIVITY_MULTIPLIERS);
    const { summary } = topic("energy");
    expect(summary).toContain(`from ${Math.min(...factors)}`);
    expect(summary).toContain(`to ${Math.max(...factors)}`);
  });

  test("the protein summary states the profiles' range", () => {
    const perKg = PROTEIN_PROFILES.map((profile) => profile.proteinPerKg);
    const { summary } = topic("protein");
    expect(summary).toContain(
      `between ${Math.min(...perKg)} and ${Math.max(...perKg)} g per kg`,
    );
  });
});
