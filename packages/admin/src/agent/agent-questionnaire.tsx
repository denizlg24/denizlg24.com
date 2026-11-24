"use client";

import type { AgentQuestionOutput } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { cn } from "@repo/ui/utils";
import { Check, CircleHelp } from "lucide-react";
import { useState } from "react";
import type { AgentToolPart } from "./agent-parts";
import {
  answersOf,
  buildQuestionAnswers,
  emptyDraft,
  isAnswered,
  type QuestionDraft,
  questionsOf,
  toggleOption,
} from "./agent-questions";

/**
 * `ask_user` drawn in the transcript. While the call waits it is a form; the
 * answer goes back as the call's output and the same turn carries on. Once
 * answered (or interrupted) it shows what was chosen.
 */
export function AgentQuestionnaire({
  part,
  onAnswer,
}: {
  part: AgentToolPart;
  onAnswer?: (toolCallId: string, output: AgentQuestionOutput) => void;
}) {
  const questions = questionsOf(part.input);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>({});
  const [sent, setSent] = useState(false);
  // An answer whose request failed comes back from the server as a waiting
  // call again; the form has to come back with it.
  const [seenState, setSeenState] = useState(part.state);
  if (seenState !== part.state) {
    setSeenState(part.state);
    if (part.state === "input-available") setSent(false);
  }

  if (part.state === "input-streaming") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CircleHelp className="size-3.5" />
        <span className="shimmer">Asking</span>
      </div>
    );
  }
  if (!questions) {
    // A call the form cannot draw still has to be answerable, or the thread
    // waits on it for good.
    if (part.state !== "input-available" || !onAnswer || sent) return null;
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-surface/40 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          <CircleHelp className="size-3.5" />
          Malformed question
        </span>
        <Button
          variant="ghost"
          className="h-7 px-2 text-xs"
          onClick={() => {
            setSent(true);
            onAnswer(part.toolCallId, { dismissed: true });
          }}
        >
          Skip
        </Button>
      </div>
    );
  }

  const waiting = part.state === "input-available" && !sent && onAnswer;
  const stored =
    part.state === "output-available" ? answersOf(part.output) : null;
  const complete = questions.every((question) =>
    isAnswered(drafts[question.id]),
  );

  const submit = (output: AgentQuestionOutput) => {
    if (!onAnswer) return;
    setSent(true);
    onAnswer(part.toolCallId, output);
  };

  return (
    <div
      className="space-y-3 rounded-lg border border-border/70 bg-surface/40 p-3"
      data-agent-questionnaire
    >
      {questions.map((question) => {
        const draft = drafts[question.id] ?? emptyDraft();
        const answer = Array.isArray(stored)
          ? stored.find((entry) => entry.id === question.id)
          : undefined;
        return (
          <fieldset key={question.id} className="min-w-0 space-y-1.5">
            <legend className="mb-1.5 w-full space-y-0.5">
              {question.header ? (
                <span className="block text-[11px] text-muted-foreground uppercase tracking-wide">
                  {question.header}
                </span>
              ) : null}
              <span className="block text-sm">{question.question}</span>
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {question.options.map((option) => {
                const chosen = waiting
                  ? draft.selected.includes(option.label)
                  : (answer?.selected.includes(option.label) ?? false);
                return (
                  <button
                    key={option.label}
                    type="button"
                    disabled={!waiting}
                    aria-pressed={chosen}
                    title={option.description}
                    onClick={() =>
                      setDrafts((current) => ({
                        ...current,
                        [question.id]: toggleOption(
                          question,
                          current[question.id] ?? emptyDraft(),
                          option.label,
                        ),
                      }))
                    }
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 rounded-md border px-2 py-1 text-left text-xs transition-colors",
                      chosen
                        ? "border-foreground/40 bg-foreground text-background"
                        : "border-border bg-background text-foreground",
                      waiting
                        ? "hover:border-foreground/40"
                        : !chosen && "text-muted-foreground opacity-60",
                    )}
                  >
                    {chosen ? <Check className="size-3 shrink-0" /> : null}
                    <span className="truncate">{option.label}</span>
                  </button>
                );
              })}
            </div>
            {waiting ? (
              <Input
                value={draft.other}
                placeholder="Other"
                className="h-7 text-xs"
                onChange={(event) => {
                  const other = event.target.value;
                  setDrafts((current) => ({
                    ...current,
                    [question.id]: {
                      ...(current[question.id] ?? emptyDraft()),
                      other,
                    },
                  }));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && complete) {
                    event.preventDefault();
                    submit(buildQuestionAnswers(questions, drafts));
                  }
                }}
              />
            ) : answer?.other ? (
              <p className="text-xs text-muted-foreground">{answer.other}</p>
            ) : null}
          </fieldset>
        );
      })}
      {waiting ? (
        <div className="flex justify-end gap-1.5">
          <Button
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => submit({ dismissed: true })}
          >
            Skip
          </Button>
          <Button
            className="h-7 px-3 text-xs"
            disabled={!complete}
            onClick={() => submit(buildQuestionAnswers(questions, drafts))}
          >
            Answer
          </Button>
        </div>
      ) : stored === "dismissed" ? (
        <p className="text-xs text-muted-foreground">Skipped</p>
      ) : part.state === "output-error" ? (
        <p className="text-xs text-muted-foreground">{part.errorText}</p>
      ) : null}
    </div>
  );
}
