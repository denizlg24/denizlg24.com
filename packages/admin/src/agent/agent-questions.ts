import {
  type AgentQuestion,
  type AgentQuestionAnswer,
  type AgentQuestionOutput,
  agentQuestionInputSchema,
  agentQuestionOutputSchema,
} from "@repo/schemas";

/** The questions an `ask_user` call carries, or null for a malformed call. */
export function questionsOf(input: unknown): AgentQuestion[] | null {
  const parsed = agentQuestionInputSchema.safeParse(input);
  return parsed.success ? parsed.data.questions : null;
}

export interface QuestionDraft {
  selected: string[];
  other: string;
}

export function emptyDraft(): QuestionDraft {
  return { selected: [], other: "" };
}

/** Picking an option: single-select replaces, multi-select toggles. */
export function toggleOption(
  question: AgentQuestion,
  draft: QuestionDraft,
  label: string,
): QuestionDraft {
  if (!question.multiSelect) {
    return {
      ...draft,
      selected: draft.selected[0] === label ? [] : [label],
    };
  }
  return {
    ...draft,
    selected: draft.selected.includes(label)
      ? draft.selected.filter((entry) => entry !== label)
      : [...draft.selected, label],
  };
}

export function isAnswered(draft: QuestionDraft | undefined): boolean {
  return Boolean(draft && (draft.selected.length > 0 || draft.other.trim()));
}

/** The tool output for a filled questionnaire; options keep the order offered. */
export function buildQuestionAnswers(
  questions: readonly AgentQuestion[],
  drafts: Readonly<Record<string, QuestionDraft>>,
): AgentQuestionOutput {
  const answers: AgentQuestionAnswer[] = questions.map((question) => {
    const draft = drafts[question.id] ?? emptyDraft();
    const offered = question.options.map((option) => option.label);
    const other = draft.other.trim();
    return {
      id: question.id,
      selected: offered.filter((label) => draft.selected.includes(label)),
      ...(other ? { other } : {}),
    };
  });
  return { answers };
}

/** A stored answer, for drawing what was chosen once the turn moved on. */
export function answersOf(
  output: unknown,
): AgentQuestionAnswer[] | "dismissed" | null {
  const parsed = agentQuestionOutputSchema.safeParse(output);
  if (!parsed.success) return null;
  return "dismissed" in parsed.data ? "dismissed" : parsed.data.answers;
}
