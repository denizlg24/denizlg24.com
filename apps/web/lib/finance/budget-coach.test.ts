import { describe, expect, test } from "bun:test";
import { normalizeCoachAction, parseCoachSuggestions } from "./budget-coach";

/**
 * The coach reads a model's output, so the cases that matter are the ones a
 * model actually produced. The payload in `observedModelResponse` is a real
 * response that failed validation three ways at once.
 */

const observedModelResponse = {
  suggestions: [
    {
      title: "Create Groceries Envelope",
      rationale:
        "Groceries is a recurring essential category with 190.11 EUR spent this month.",
      action: {
        create_envelope: {
          name: "Groceries",
          categories: ["Groceries"],
          limit: 200,
          period: "monthly",
          envelopeKind: "flexible",
          rollover: false,
        },
      },
    },
    {
      title: "Create Digital Services Envelope",
      rationale: "Digital Services represents 101.91 EUR in recurring costs.",
      action: {
        create_envelope: {
          name: "Digital Services",
          categories: ["Digital Services"],
          limit: 105,
          period: "monthly",
          envelopeKind: "fixed",
          rollover: false,
        },
      },
    },
  ],
};

describe("normalizeCoachAction", () => {
  test("unwraps an action tagged by key instead of by kind", () => {
    expect(
      normalizeCoachAction({
        create_envelope: { name: "Groceries", limit: 200 },
      }),
    ).toEqual({ kind: "create_envelope", name: "Groceries", limit: 200 });
  });

  test("leaves an already-correct action alone", () => {
    const action = { kind: "set_limit", envelopeId: "e1", limit: 300 };
    expect(normalizeCoachAction(action)).toEqual(action);
  });

  test("maps envelope-kind synonyms onto the two that exist", () => {
    for (const kind of ["flexible", "fixed", "Variable", "cap"]) {
      expect(
        normalizeCoachAction({ kind: "create_envelope", envelopeKind: kind }),
      ).toEqual({
        kind: "create_envelope",
        envelopeKind: "capped",
      });
    }
    for (const kind of ["sinking", "goal", "Savings"]) {
      expect(
        normalizeCoachAction({ kind: "create_envelope", envelopeKind: kind }),
      ).toEqual({
        kind: "create_envelope",
        envelopeKind: "sinking",
      });
    }
  });

  test("coerces a boolean rollover into the enum", () => {
    expect(
      normalizeCoachAction({ kind: "create_envelope", rollover: false }),
    ).toEqual({ kind: "create_envelope", rollover: "none" });
    expect(
      normalizeCoachAction({ kind: "create_envelope", rollover: true }),
    ).toEqual({ kind: "create_envelope", rollover: "surplus" });
  });

  test("leaves an unrecognised value for validation to reject", () => {
    expect(
      normalizeCoachAction({ kind: "create_envelope", envelopeKind: "banana" }),
    ).toEqual({ kind: "create_envelope", envelopeKind: "banana" });
  });

  test("an unknown wrapper key is not mistaken for an action", () => {
    expect(normalizeCoachAction({ do_something: { a: 1 } })).toEqual({
      do_something: { a: 1 },
    });
  });
});

describe("parseCoachSuggestions", () => {
  test("accepts the response that used to fail outright", () => {
    const parsed = parseCoachSuggestions(observedModelResponse);
    expect(parsed?.rejected).toBe(0);
    expect(parsed?.suggestions).toHaveLength(2);
    const [groceries, digital] = parsed?.suggestions ?? [];
    expect(groceries?.action).toEqual({
      kind: "create_envelope",
      name: "Groceries",
      categories: ["Groceries"],
      limit: 200,
      period: "monthly",
      envelopeKind: "capped",
      rollover: "none",
    });
    // A recurring bill is a spending limit, not a savings goal.
    expect(
      digital?.action.kind === "create_envelope" && digital.action.envelopeKind,
    ).toBe("capped");
  });

  test("one malformed suggestion does not lose the rest", () => {
    const parsed = parseCoachSuggestions({
      suggestions: [
        { title: "Fine", action: { kind: "advice" } },
        { title: "Broken", action: { kind: "set_limit" } },
        { title: "Also fine", action: { kind: "advice" } },
      ],
    });
    expect(parsed?.suggestions).toHaveLength(2);
    expect(parsed?.rejected).toBe(1);
  });

  test("a bare array is accepted as the batch", () => {
    const parsed = parseCoachSuggestions([
      { title: "Advice", action: { kind: "advice" } },
    ]);
    expect(parsed?.suggestions).toHaveLength(1);
  });

  test("a response with no array at all is an error, not an empty batch", () => {
    expect(
      parseCoachSuggestions({ text: "here are some ideas" }),
    ).toBeUndefined();
    expect(parseCoachSuggestions(null)).toBeUndefined();
  });

  test("caps a model that ignores the limit", () => {
    const parsed = parseCoachSuggestions({
      suggestions: Array.from({ length: 20 }, (_, index) => ({
        title: `Advice ${index}`,
        action: { kind: "advice" },
      })),
    });
    expect(parsed?.suggestions).toHaveLength(8);
  });

  test("a missing rationale defaults rather than rejecting the suggestion", () => {
    const parsed = parseCoachSuggestions({
      suggestions: [{ title: "Terse", action: { kind: "advice" } }],
    });
    expect(parsed?.suggestions[0]?.rationale).toBe("");
  });
});
