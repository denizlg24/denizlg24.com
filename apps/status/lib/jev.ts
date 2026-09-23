import { createGateway } from "@ai-sdk/gateway";
import { jevConfidence, jevIsTrue } from "@repo/schemas";
import { experimental_evaluate as evaluate } from "ai";
import { describeEvidence, statusWord } from "./incidents";
import type { Incident, Service } from "./model";

/**
 * The cheap verdict, before the expensive one.
 *
 * Every automatic incident starts a full agent run on denizlg24.com: a
 * reasoning model with the whole infrastructure toolset, reading logs and
 * deployments for several minutes. Most incidents do not deserve that. A
 * two-minute deploy swap, the Sunday 02:00 UTC reboot, one upstream blip —
 * three failed observations is all it takes to open one, and the run's
 * conclusion is "transient" often enough that it is the common case.
 *
 * Jev answers the same three-way question from the evidence the collector
 * already holds, in one request with no tools. A decided `transient` records
 * the verdict and skips the run; anything else, or any doubt at all, starts
 * the run exactly as before. The gate can only ever remove work from the
 * case where a fast model is confident and the slow one would have agreed.
 */

/** Margin between the top two verdicts before the run is skipped. */
const SKIP_MARGIN = 0.4;
const TIMEOUT_MS = 15_000;
const DEFAULT_JEV_MODEL = "typesafe-ai/jev";

const QUESTIONS = {
  verdict: {
    type: "choice",
    instructions:
      "What kind of incident is this, judging only by the evidence below?",
    criteria: {
      transient:
        "It has recovered, or it will on its own, and nothing is actually wrong: a deploy rolling, a scheduled reboot, one upstream blip, a probe that timed out once.",
      operational:
        "Something is still down and an operator action would fix it: a container to restart, a deployment to roll back, a failed task to re-run.",
      code: "The cause looks like a defect in the application's own code or configuration, which no restart will fix.",
    },
  },
  alreadyRecovered: {
    type: "boolean",
    instructions:
      "Does the evidence show the affected services answering normally again?",
    criteria: {
      true: "The most recent observations pass.",
      false: "The most recent observations still fail, or there are none.",
    },
  },
} as const;

export interface PreVerdict {
  model: string;
  verdict: "transient" | "operational" | "code";
  confidence: number;
  alreadyRecovered: boolean;
  /** Whether the full triage run can be skipped. */
  skipTriage: boolean;
}

type JevState = Parameters<typeof evaluate>[0]["state"];

function jevState(
  incident: Incident,
  services: Service[],
  statusOrigin: string,
): JevState {
  return {
    status_page: statusOrigin,
    incident: {
      title: incident.title,
      started_at: incident.startedAt,
      recovered_at: incident.recoveredAt ?? null,
    },
    services: services.map((service) => ({
      name: service.name,
      status: statusWord(service.status),
      evidence: describeEvidence(service.evidence),
    })),
    known_causes: [
      "The host reboots every Sunday at 02:00 UTC.",
      "A Forge deployment swaps containers, which can fail two or three observations in a row.",
      "Confirmed down means three consecutive failed observations outside any maintenance window.",
    ],
  };
}

/**
 * Answers null whenever the gate cannot be trusted to have run — no gateway
 * key, an unreachable model, a timeout. The caller then starts the triage run
 * as it always did, so an unavailable Jev costs nothing but a missed saving.
 */
export async function preVerdict(
  incident: Incident,
  services: Service[],
  statusOrigin: string,
): Promise<PreVerdict | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return null;
  try {
    const result = await evaluate({
      model: createGateway({ apiKey }).evaluationModel(
        process.env.JEV_MODEL_ID?.trim() || DEFAULT_JEV_MODEL,
      ),
      state: jevState(incident, services, statusOrigin),
      questions: QUESTIONS,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const verdict = result.answers.verdict.choice;
    if (
      verdict !== "transient" &&
      verdict !== "operational" &&
      verdict !== "code"
    ) {
      return null;
    }
    const confidence = jevConfidence(result.answers.verdict);
    return {
      model: result.response.modelId,
      verdict,
      confidence,
      alreadyRecovered: jevIsTrue(result.answers.alreadyRecovered, 0),
      // Only "transient" skips. An operational or code verdict is exactly
      // the case that needs the agent, and this model has no tools to act.
      skipTriage: verdict === "transient" && confidence >= SKIP_MARGIN,
    };
  } catch (error) {
    console.warn("[status] Jev pre-verdict failed:", error);
    return null;
  }
}
