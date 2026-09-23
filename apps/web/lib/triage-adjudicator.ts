import {
  jevConfidence,
  jevIsTrue,
  jevRoundProbabilities,
  TRIAGE_CATEGORIES,
} from "@repo/schemas";
import { evaluateQuestions } from "@/lib/llm-service";
import type { TriageCategory } from "@/models/EmailTriage";

/**
 * The second opinion on an email the fine-tuned classifier was not sure
 * about.
 *
 * The classifier is trained on this inbox and is right most of the time; what
 * it cannot do is know when it is wrong in an interesting way. Below the
 * confidence threshold its answer was thrown away and the email went to a
 * queue the owner has to empty by hand. Jev answers the same seven-way
 * question with a calibrated distribution, so a case the classifier found
 * ambiguous and Jev finds obvious stops being a chore.
 *
 * It only ever runs on the emails already destined for review: a confident
 * classifier answer is never second-guessed, so this cannot make the common
 * path worse or slower.
 */

/** Margin between the top two categories before Jev's answer is taken. */
const DEFAULT_DECISION_MARGIN = 0.25;

/**
 * The rubric. Each entry is what that category means *in this inbox* — the
 * classifier learnt these boundaries from the owner's own corrections, and
 * Jev has to be told them.
 */
const CATEGORY_CRITERIA: Record<TriageCategory, string> = {
  spam: "Unsolicited, fraudulent, or a phishing attempt. Not merely unwanted marketing from a real company.",
  newsletter:
    "A subscribed recurring publication: a digest, a release digest, a mailing list, a blog broadcast. Nothing is being sold.",
  promo:
    "Marketing from a company the owner has a relationship with: a sale, a discount, a product announcement, a win-back.",
  purchases:
    "A transaction that already happened: an order confirmation, a receipt, an invoice, a shipping or delivery notice, a refund.",
  fyi: "Informational and needs no reply and no diary entry: a notification, a status change, a statement, an automated report.",
  "action-needed":
    "Something the owner must personally do, with no fixed time attached: reply, confirm, submit, renew, pay, approve, upload a document.",
  scheduled:
    "Anchored to a specific date and time the owner is expected to attend or observe: an invitation, a booking, an appointment, an exam, a deadline with a date.",
};

const QUESTIONS = {
  category: {
    type: "choice",
    instructions:
      "Which single category does this email belong to for the person who received it?",
    criteria: CATEGORY_CRITERIA,
  },
  needsPersonalAction: {
    type: "boolean",
    instructions:
      "Must the recipient personally do something for this, beyond reading it?",
    criteria: {
      true: "The sender is waiting on the recipient: a reply, a form, a payment, a confirmation, a decision.",
      false:
        "Purely informational, already handled, automated, or addressed to a list.",
    },
  },
  hasDatedCommitment: {
    type: "boolean",
    instructions:
      "Does this email name a specific date and time the recipient is expected to attend or meet?",
    criteria: {
      true: "An appointment, a meeting, an exam, a booking, or a dated deadline.",
      false:
        "No date, or only a date the sender mentions in passing with nothing expected of the recipient.",
    },
  },
} as const;

export interface TriageAdjudication {
  model: string;
  category: TriageCategory;
  /** Margin between the top two categories, in [0, 1]. */
  confidence: number;
  probabilities: Record<string, number> | undefined;
  needsPersonalAction: boolean;
  hasDatedCommitment: boolean;
  /** Whether the margin cleared the threshold, so the answer is used. */
  decided: boolean;
}

function isTriageCategory(value: string): value is TriageCategory {
  return (TRIAGE_CATEGORIES as readonly string[]).includes(value);
}

export interface AdjudicateInput {
  subject: string;
  from: string;
  body: string;
  /** What the fine-tuned classifier said, so the state carries both views. */
  classifierCategory: TriageCategory;
  classifierConfidence: number;
  decisionMargin?: number;
  signal?: AbortSignal;
}

/**
 * Answers null when Jev could not be reached or returned a category this
 * build does not know. A failed adjudication is never an error: the email
 * simply stays in the review queue, which is where it already was.
 */
export async function adjudicateTriage({
  subject,
  from,
  body,
  classifierCategory,
  classifierConfidence,
  decisionMargin = DEFAULT_DECISION_MARGIN,
  signal,
}: AdjudicateInput): Promise<TriageAdjudication | null> {
  try {
    const { answers, model } = await evaluateQuestions({
      purpose: "triage-adjudicate",
      source: "triage-adjudicate",
      describe: "Adjudicate a low-confidence email classification.",
      // The classifier's own guess is part of the state rather than part of
      // the question: Jev is told what the weak model thought and left to
      // agree or not, which is what makes a disagreement worth reading.
      state: {
        subject,
        from,
        body,
        weak_classifier: {
          category: classifierCategory,
          confidence: Number(classifierConfidence.toFixed(3)),
          note: "A small model fine-tuned on this inbox. Below its confidence threshold, which is why you are being asked.",
        },
      },
      questions: QUESTIONS,
      signal,
    });

    const category = answers.category.choice;
    if (!isTriageCategory(category)) return null;
    const confidence = jevConfidence(answers.category);
    return {
      model,
      category,
      confidence,
      probabilities: jevRoundProbabilities(answers.category.probabilities),
      needsPersonalAction: jevIsTrue(answers.needsPersonalAction, 0),
      hasDatedCommitment: jevIsTrue(answers.hasDatedCommitment, 0),
      decided: confidence >= decisionMargin,
    };
  } catch (error) {
    console.warn("[triage] Jev adjudication failed:", error);
    return null;
  }
}
