import { createGateway } from "@ai-sdk/gateway";
import { experimental_evaluate as evaluate } from "ai";
import { LlmConfigurationError } from "@/lib/llm-errors";

// The evaluation side of the Vercel AI Gateway. Jev is a System One model:
// it takes one shared state and a map of typed questions and answers all of
// them in parallel as probability distributions, never as text. It cannot
// hallucinate a value outside the options it was given, which is the whole
// reason it is worth reaching for wherever this codebase currently asks a
// language model to pick from an enum and then trusts the number it made up
// about its own certainty.
//
// This is the Gateway, not a provider SDK — same key, same billing, same
// observability as every other model call. It needs its own transport only
// because `evaluate` takes an evaluation model rather than a language model.

/** Overridable so a newer Jev revision can be pinned without a release. */
const DEFAULT_JEV_MODEL = "typesafe-ai/jev";

let provider: ReturnType<typeof createGateway> | null = null;
let providerKey: string | null = null;

function gatewayProvider(): ReturnType<typeof createGateway> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new LlmConfigurationError(
      "AI_GATEWAY_API_KEY is not configured; evaluation is unavailable",
    );
  }
  if (!provider || providerKey !== apiKey) {
    provider = createGateway({ apiKey });
    providerKey = apiKey;
  }
  return provider;
}

export function jevModelId(): string {
  return process.env.JEV_MODEL_ID?.trim() || DEFAULT_JEV_MODEL;
}

export type JevQuestions = Parameters<typeof evaluate>[0]["questions"];
export type JevState = Parameters<typeof evaluate>[0]["state"];

export interface JevEvaluateRequest<Q extends JevQuestions> {
  state: JevState;
  questions: Q;
  signal?: AbortSignal;
}

/**
 * One request, every question answered against the same state. Adding a
 * question costs its own tokens and almost no extra latency, so a caller
 * that might want an answer should ask for it here rather than in a second
 * call.
 */
export async function runJevEvaluation<Q extends JevQuestions>({
  state,
  questions,
  signal,
}: JevEvaluateRequest<Q>) {
  return evaluate({
    model: gatewayProvider().evaluationModel(jevModelId()),
    state,
    questions,
    ...(signal ? { abortSignal: signal } : {}),
  });
}
