import type { LlmCatalogModel } from "@repo/schemas";

/**
 * Default pick for a fresh chat: the cheapest eligible Anthropic-created
 * model (any eligible model when none). Heuristic, not a hardcoded id.
 */
export function pickDefaultModel(
  models: LlmCatalogModel[],
  requiredCapabilities: string[],
): string | null {
  const preferredDefaults = [
    "openai/gpt-5.6-luna",
    "anthropic/claude-opus-4.8",
  ];

  for (const preferred of preferredDefaults) {
    const entry = models.find((model) => model.id === preferred);
    if (
      entry &&
      requiredCapabilities.every((tag) => entry.tags.includes(tag))
    ) {
      return entry.id;
    }
  }

  const eligible = models.filter((model) =>
    requiredCapabilities.every((tag) => model.tags.includes(tag)),
  );
  const pool = eligible.some((model) => model.creator === "anthropic")
    ? eligible.filter((model) => model.creator === "anthropic")
    : eligible;
  const cheapest = [...pool].sort(
    (left, right) =>
      (left.pricing?.input ?? Number.POSITIVE_INFINITY) -
      (right.pricing?.input ?? Number.POSITIVE_INFINITY),
  )[0];
  return cheapest?.id ?? null;
}
