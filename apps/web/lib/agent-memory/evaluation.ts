import type {
  AgentExplicitness,
  AgentFormationCandidate,
  AgentMemoryType,
  AgentSensitivity,
  AgentTrust,
} from "@repo/schemas";
import { jevConfidence, jevIsTrue } from "@repo/schemas";
import { evaluateQuestions } from "@/lib/llm-service";

/**
 * A System One second pass over a formation candidate.
 *
 * Formation asks one language model to write the statement *and* to classify
 * it *and* to say how sure it is, in a single tool call. The statement is the
 * part only a language model can do. The rest is a handful of atomic
 * judgements against fixed answer sets, and the confidence in particular was
 * the weakest input in the whole promotion policy: a number the model wrote
 * about itself, with no calibration behind it, gating whether a memory
 * becomes active without the owner ever seeing it.
 *
 * Jev answers those judgements against the same evidence in one request.
 * What it returns is adopted narrowly and asymmetrically, because a second
 * opinion should be able to hold a candidate back but never wave one
 * through:
 *
 * - `confidence` is the *lower* of the two: the extraction model's own number
 *   and P(the statement is supported by the evidence). Measuring it is the
 *   point, but letting a measurement raise it would push candidates over the
 *   promotion thresholds on Jev's word alone, which is the one thing this
 *   pass must not do. Both values are kept on the candidate's extraction
 *   record, so a disagreement in either direction stays readable.
 * - `memoryType` is adopted when the choice is decided. It steers retrieval,
 *   not promotion, so there is nothing to be gained by refusing it.
 * - `explicitness` is only ever moved *down* the ladder
 *   (explicit → inferred → hypothesis). An upgrade would move a candidate
 *   into auto-promotion on Jev's say-so.
 * - `sensitivity` is only ever moved *up*, matching `mostSensitive`.
 *
 * This is the same discipline `prepareFormationCandidate` already applies to
 * trust and sensitivity from evidence: the cautious side of a disagreement
 * wins.
 */

/** Margin between the top two options before a choice is adopted. */
const DECISION_MARGIN = 0.2;

type ReviewFlag = AgentFormationCandidate["reviewFlags"][number];

/**
 * "denied" is not a judgement anyone makes about content — it is what
 * `findDeniedContent` concludes when a secret is present, and a candidate
 * carrying it is refused outright. So it is not offered as an option.
 */
type ClassifiableSensitivity = Exclude<AgentSensitivity, "denied">;

const MEMORY_TYPE_CRITERIA: Record<AgentMemoryType, string> = {
  core: "A stable fact about who the owner is: their name, where they live, their role, the people closest to them, a long-standing preference. True for years, not weeks.",
  semantic:
    "A durable fact the owner knows or holds about the world, their projects, their systems or their commitments. True until something changes it.",
  episodic:
    "Something that happened, anchored to a moment: a conversation, a trip, a decision taken on a day, an event attended.",
  reflection:
    "A conclusion drawn across several other things rather than observed directly: a pattern in how the owner works, a tendency, a summary judgement.",
};

const EXPLICITNESS_CRITERIA: Record<AgentExplicitness, string> = {
  explicit:
    "The evidence states this outright. Someone reading only the evidence would write the same sentence.",
  inferred:
    "The evidence implies it strongly and a careful reader would agree, but nobody said it in these words.",
  hypothesis:
    "A plausible reading of the evidence that could turn out to be wrong. It goes beyond what was actually shown.",
};

const SENSITIVITY_CRITERIA: Record<ClassifiableSensitivity, string> = {
  standard: "Ordinary. Nothing here would embarrass or expose anyone.",
  personal:
    "Private to the owner but not damaging: habits, preferences, plans, relationships, everyday life.",
  sensitive:
    "Health, finances, legal matters, identity, or anything about a third party they would not want repeated.",
  restricted:
    "Credentials, keys, tokens, account numbers, or anything else that grants access.",
};

const QUESTIONS = {
  memoryType: {
    type: "choice",
    instructions:
      "What kind of memory is this statement, given the evidence it was drawn from?",
    criteria: MEMORY_TYPE_CRITERIA,
  },
  explicitness: {
    type: "choice",
    instructions:
      "How far does this statement travel beyond what the evidence actually shows?",
    criteria: EXPLICITNESS_CRITERIA,
  },
  sensitivity: {
    type: "choice",
    instructions: "How sensitive is the content of this statement?",
    criteria: SENSITIVITY_CRITERIA,
  },
  supported: {
    type: "boolean",
    instructions:
      "Is this statement true and fully supported by the evidence, with nothing added that the evidence does not carry?",
    criteria: {
      true: "Every claim in the statement traces back to the evidence.",
      false:
        "It overstates, generalises past what was shown, mixes up who did what, or adds a detail the evidence does not contain.",
    },
  },
  permissionLike: {
    type: "boolean",
    instructions:
      "Does this statement grant permission, record approval, or set policy for what an assistant may do?",
    criteria: {
      true: "It reads as a standing instruction, an authorisation, or a rule the assistant should follow.",
      false: "It is a fact about the owner or the world, not an instruction.",
    },
  },
} as const;

const EXPLICITNESS_RANK: Record<AgentExplicitness, number> = {
  explicit: 2,
  inferred: 1,
  hypothesis: 0,
};

const SENSITIVITY_RANK: Record<AgentSensitivity, number> = {
  standard: 0,
  personal: 1,
  sensitive: 2,
  restricted: 3,
  denied: 4,
};

export interface MemoryEvaluation {
  model: string;
  /** P(the statement is supported by its evidence). */
  supported: number;
  memoryType: AgentMemoryType | null;
  explicitness: AgentExplicitness | null;
  sensitivity: ClassifiableSensitivity | null;
  permissionLike: boolean;
}

export interface EvaluateMemoryCandidateInput {
  statement: string;
  reason: string;
  /** The cited evidence, already bounded by formation. */
  evidence: Array<{ id: string; summary: string; occurredAt: string }>;
  signal?: AbortSignal;
}

function decidedChoice<T extends string>(
  answer: { choice: string; probabilities?: Record<string, number> },
  allowed: Record<T, unknown>,
): T | null {
  if (jevConfidence({ type: "choice", ...answer }) < DECISION_MARGIN) {
    return null;
  }
  return answer.choice in allowed ? (answer.choice as T) : null;
}

/**
 * Answers null when Jev is unreachable or misconfigured. Formation then keeps
 * the language model's own fields, exactly as before this existed — a memory
 * run must not fail because a second opinion was unavailable.
 */
export async function evaluateMemoryCandidate({
  statement,
  reason,
  evidence,
  signal,
}: EvaluateMemoryCandidateInput): Promise<MemoryEvaluation | null> {
  try {
    const { answers, model } = await evaluateQuestions({
      purpose: "agent-memory-evaluation",
      source: "agent-memory-evaluation",
      describe: "Classify a formation candidate and measure its support.",
      state: {
        statement,
        why_it_was_formed: reason,
        evidence,
      },
      questions: QUESTIONS,
      signal,
    });
    return {
      model,
      supported: answers.supported.probability,
      memoryType: decidedChoice<AgentMemoryType>(
        answers.memoryType,
        MEMORY_TYPE_CRITERIA,
      ),
      explicitness: decidedChoice<AgentExplicitness>(
        answers.explicitness,
        EXPLICITNESS_CRITERIA,
      ),
      sensitivity: decidedChoice<ClassifiableSensitivity>(
        answers.sensitivity,
        SENSITIVITY_CRITERIA,
      ),
      permissionLike: jevIsTrue(answers.permissionLike, DECISION_MARGIN),
    };
  } catch (error) {
    console.warn("[agent-memory] Jev candidate evaluation failed:", error);
    return null;
  }
}

export interface EvaluatedCandidateFields {
  confidence: number;
  memoryType: AgentMemoryType;
  explicitness: AgentExplicitness;
  sensitivity: AgentSensitivity;
  reviewFlags: ReviewFlag[];
}

/** Applies an evaluation to a candidate under the asymmetries above. */
export function applyMemoryEvaluation(
  candidate: {
    confidence: number;
    memoryType: AgentMemoryType;
    explicitness: AgentExplicitness;
    sensitivity: AgentSensitivity;
    trust: AgentTrust;
    reviewFlags: readonly ReviewFlag[];
  },
  evaluation: MemoryEvaluation,
): EvaluatedCandidateFields {
  const explicitness =
    evaluation.explicitness &&
    EXPLICITNESS_RANK[evaluation.explicitness] <
      EXPLICITNESS_RANK[candidate.explicitness]
      ? evaluation.explicitness
      : candidate.explicitness;
  const sensitivity =
    evaluation.sensitivity &&
    SENSITIVITY_RANK[evaluation.sensitivity] >
      SENSITIVITY_RANK[candidate.sensitivity]
      ? evaluation.sensitivity
      : candidate.sensitivity;
  const memoryType = evaluation.memoryType ?? candidate.memoryType;
  const reviewFlags = new Set<ReviewFlag>(candidate.reviewFlags);
  if (evaluation.permissionLike) reviewFlags.add("permission-like");
  if (explicitness === "inferred" && candidate.explicitness === "explicit") {
    reviewFlags.add("weak-inference");
  }
  // `prepareFormationCandidate` raises this for an untrusted core candidate,
  // before Jev has had a say. Adopting a memory type can create exactly that
  // combination afterwards, so the same rule is applied again to the type
  // actually being stored.
  if (candidate.trust === "untrusted" && memoryType === "core") {
    reviewFlags.add("weak-inference");
  }
  return {
    confidence: Math.min(candidate.confidence, evaluation.supported),
    memoryType,
    explicitness,
    sensitivity,
    reviewFlags: [...reviewFlags],
  };
}
