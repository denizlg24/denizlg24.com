export interface FoodIconRule {
  iconKey: string;
  priority?: number;
  patterns: string[];
}

export interface FoodIconRules {
  defaultIconKey: string;
  rules: FoodIconRule[];
}

export interface CompiledFoodIconRules {
  defaultIconKey: string;
  rules: Array<{ iconKey: string; regex: RegExp }>;
}

export const compileFoodIconRules = (
  config: FoodIconRules,
): CompiledFoodIconRules => {
  if (!config.defaultIconKey) throw new Error("defaultIconKey is required");
  if (!Array.isArray(config.rules)) throw new Error("rules must be an array");

  const rules = [...config.rules]
    .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
    .map((rule) => {
      if (
        !rule.iconKey ||
        !Array.isArray(rule.patterns) ||
        rule.patterns.length === 0
      ) {
        throw new Error("Every rule requires iconKey and at least one pattern");
      }

      return {
        iconKey: rule.iconKey,
        regex: new RegExp(
          rule.patterns.map((pattern) => `(?:${pattern})`).join("|"),
          "iu",
        ),
      };
    });

  return { defaultIconKey: config.defaultIconKey, rules };
};

export const classifyFoodIcon = (
  compiled: CompiledFoodIconRules,
  name: string,
  brand: string | null = null,
) => {
  // Match accented names consistently while retaining Unicode-aware regexes.
  // This also makes trailing word boundaries work for words such as "café".
  const text = `${name} ${brand ?? ""}`
    .normalize("NFKD")
    .replace(/\p{M}/gu, "");
  return (
    compiled.rules.find((rule) => rule.regex.test(text))?.iconKey ??
    compiled.defaultIconKey
  );
};
