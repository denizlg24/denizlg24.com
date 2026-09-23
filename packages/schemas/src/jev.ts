import { z } from "zod";

/**
 * Reading a System One answer.
 *
 * Jev (`typesafe-ai/jev` through the AI Gateway) answers typed questions
 * against one shared state and returns a probability distribution per
 * question rather than prose. The wire shape the AI SDK's
 * `experimental_evaluate` hands back carries `probabilities` but no single
 * confidence number, so this module defines the one we gate on, in one place,
 * for every caller.
 *
 * **Confidence here is the margin: the probability mass separating the winner
 * from the runner-up.** Top-1 probability alone is not comparable across
 * question shapes — 0.5 is decisive between two options and a coin toss
 * between seven — whereas the margin answers the only question a gate asks:
 * did it actually pick one? It falls out the same way for every primitive,
 * which is why there is one formula and not three.
 */

export const jevChoiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

export const jevScoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  probabilities: z.record(z.string(), z.number()).optional(),
});

export const jevBooleanAnswerSchema = z.object({
  type: z.literal("boolean"),
  probability: z.number(),
});

export const jevAnswerSchema = z.discriminatedUnion("type", [
  jevChoiceAnswerSchema,
  jevScoreAnswerSchema,
  jevBooleanAnswerSchema,
]);

export type JevChoiceAnswer = z.infer<typeof jevChoiceAnswerSchema>;
export type JevScoreAnswer = z.infer<typeof jevScoreAnswerSchema>;
export type JevBooleanAnswer = z.infer<typeof jevBooleanAnswerSchema>;
export type JevAnswer = z.infer<typeof jevAnswerSchema>;

/**
 * The gap between the two most likely outcomes, in [0, 1].
 *
 * A question whose distribution the model did not return is read as
 * undecided (0) rather than certain: absence of evidence must never open a
 * gate. A single-option choice is the one exception — there was nothing to
 * separate, so it is 1.
 */
export function jevConfidence(answer: JevAnswer): number {
  if (answer.type === "boolean") {
    return Math.min(1, Math.abs(2 * answer.probability - 1));
  }
  const values = Object.values(answer.probabilities ?? {});
  if (values.length === 0) return 0;
  if (values.length === 1) return 1;
  const [first = 0, second = 0] = [...values].sort((a, b) => b - a);
  return Math.min(1, Math.max(0, first - second));
}

/** The winning option's own probability, for reporting beside the margin. */
export function jevTopProbability(answer: JevAnswer): number {
  if (answer.type === "boolean")
    return Math.max(answer.probability, 1 - answer.probability);
  const values = Object.values(answer.probabilities ?? {});
  return values.length === 0 ? 0 : Math.max(...values);
}

/** True when the margin clears `threshold`; the shape every gate here takes. */
export function jevDecided(answer: JevAnswer, threshold: number): boolean {
  return jevConfidence(answer) >= threshold;
}

/**
 * What a Noul actually asserts. `probability` is P(true), so a gate on "is
 * this a receipt" wants both a decided answer and the true side of it.
 */
export function jevIsTrue(
  answer: JevBooleanAnswer,
  threshold: number,
): boolean {
  return answer.probability >= 0.5 && jevDecided(answer, threshold);
}

/** Probabilities rounded for storage, so a persisted trace stays readable. */
export function jevRoundProbabilities(
  probabilities: Record<string, number> | undefined,
): Record<string, number> | undefined {
  if (!probabilities) return undefined;
  return Object.fromEntries(
    Object.entries(probabilities).map(([key, value]) => [
      key,
      Math.round(value * 1000) / 1000,
    ]),
  );
}
