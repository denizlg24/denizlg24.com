import { describe, expect, test } from "bun:test";
import type { LlmCatalogModel } from "@/lib/data-types";
import {
  isModelEligible,
  modelDisplayName,
  pickDefaultModel,
} from "./use-model-catalog";

// Logic behind the dynamic model selector: capability eligibility,
// catalog-based labels with raw-id fallback, and the cheap-default pick.

const models: LlmCatalogModel[] = [
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    creator: "anthropic",
    tags: ["tool-use", "web-search"],
    contextWindow: 200000,
    pricing: { input: 0.000001, output: 0.000005 },
  },
  {
    id: "anthropic/claude-opus-4.7",
    name: "Claude Opus 4.7",
    creator: "anthropic",
    tags: ["tool-use", "web-search", "reasoning"],
    contextWindow: 1000000,
    pricing: { input: 0.000005, output: 0.000025 },
  },
  {
    id: "mistral/plain-model",
    name: "Plain Model",
    creator: "mistral",
    tags: [],
    pricing: { input: 0.0000001, output: 0.0000002 },
  },
];

describe("isModelEligible", () => {
  test("checks required capabilities against catalog tags", () => {
    expect(isModelEligible("mistral/plain-model", models, ["tool-use"])).toBe(
      false,
    );
    expect(
      isModelEligible("anthropic/claude-haiku-4.5", models, [
        "tool-use",
        "web-search",
      ]),
    ).toBe(true);
  });

  test("passes unknown models through for the server to validate", () => {
    expect(isModelEligible("anthropic/unlisted", models, ["tool-use"])).toBe(
      true,
    );
    expect(isModelEligible("anything", null, ["tool-use"])).toBe(true);
  });
});

describe("modelDisplayName", () => {
  test("resolves labels from the catalog", () => {
    expect(modelDisplayName("anthropic/claude-opus-4.7", models)).toBe(
      "Claude Opus 4.7",
    );
  });

  test("falls back to the raw id for old conversations", () => {
    expect(modelDisplayName("claude-haiku-4-5", models)).toBe(
      "claude-haiku-4-5",
    );
    expect(modelDisplayName("anthropic/claude-x", null)).toBe(
      "anthropic/claude-x",
    );
  });
});

describe("pickDefaultModel", () => {
  test("picks the cheapest eligible anthropic model", () => {
    expect(pickDefaultModel(models, ["tool-use"])).toBe(
      "anthropic/claude-haiku-4.5",
    );
  });

  test("falls back to any eligible model when anthropic has none", () => {
    expect(pickDefaultModel(models.slice(2), [])).toBe("mistral/plain-model");
  });

  test("returns null when nothing satisfies the capabilities", () => {
    expect(pickDefaultModel(models, ["image-generation"])).toBeNull();
  });
});
