"use client";

import type { Question, QuestionBody, QuestionKind } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { ListRow } from "@repo/ui/list";
import { RadioGroup, RadioGroupItem } from "@repo/ui/radio-group";
import { Textarea } from "@repo/ui/textarea";
import { FilterTabs } from "@repo/ui/toolbar";
import { Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { createQuestions, deleteQuestion, updateQuestion } from "./study-api";
import { errorMessage } from "./study-format";

export const QUESTION_KIND_LABEL: Record<QuestionKind, string> = {
  mcq: "MCQ",
  "true-false": "T/F",
  short: "Short",
};

type Difficulty = "easy" | "medium" | "hard" | "none";

function blankBody(kind: QuestionKind): QuestionBody {
  if (kind === "mcq") return { kind, options: ["", ""], correctIndex: 0 };
  if (kind === "true-false") return { kind, correct: true };
  return { kind, reference: "" };
}

function bodyValid(body: QuestionBody): boolean {
  if (body.kind === "mcq") {
    return (
      body.options.length >= 2 &&
      body.options.every((option) => option.trim()) &&
      body.correctIndex < body.options.length
    );
  }
  if (body.kind === "short") return Boolean(body.reference.trim());
  return true;
}

function trimBody(body: QuestionBody): QuestionBody {
  if (body.kind === "mcq") {
    return { ...body, options: body.options.map((option) => option.trim()) };
  }
  if (body.kind === "short")
    return { ...body, reference: body.reference.trim() };
  return body;
}

export function QuestionDialog({
  open,
  onOpenChange,
  notebookId,
  question,
  onSaved,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  question: Question | null;
  onSaved: (question: Question) => void;
  onDeleted?: (questionId: string) => void;
}) {
  const { client } = useAdmin();
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [body, setBody] = useState<QuestionBody>(
    question?.body ?? blankBody("mcq"),
  );
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [difficulty, setDifficulty] = useState<Difficulty>(
    question?.difficulty ?? "none",
  );
  const [pending, setPending] = useState(false);

  const valid = Boolean(prompt.trim()) && bodyValid(body);

  const submit = async () => {
    if (!valid) return;
    setPending(true);
    try {
      const fields = {
        prompt: prompt.trim(),
        body: trimBody(body),
      };
      if (question) {
        onSaved(
          await updateQuestion(client, question._id, {
            ...fields,
            explanation: explanation.trim() || null,
            difficulty: difficulty === "none" ? null : difficulty,
          }),
        );
      } else {
        const [created] = await createQuestions(client, {
          notebookId,
          questions: [
            {
              ...fields,
              ...(explanation.trim()
                ? { explanation: explanation.trim() }
                : {}),
              ...(difficulty !== "none" ? { difficulty } : {}),
            },
          ],
        });
        if (created) onSaved(created);
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save question"));
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!question) return;
    setPending(true);
    try {
      await deleteQuestion(client, question._id);
      onDeleted?.(question._id);
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete question"));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={question ? "Edit question" : "New question"}
      onSubmit={submit}
      submitDisabled={!valid}
      pending={pending}
      footerStart={
        question && onDeleted ? (
          <Button
            type="button"
            variant="destructive"
            onClick={() => void remove()}
            disabled={pending}
          >
            Delete
          </Button>
        ) : undefined
      }
    >
      <FormGrid>
        <FormField label="Kind">
          <FilterTabs
            value={body.kind}
            onChange={(kind) => {
              if (kind !== body.kind) setBody(blankBody(kind));
            }}
            options={[
              { value: "mcq", label: "Multiple choice" },
              { value: "true-false", label: "True / false" },
              { value: "short", label: "Short answer" },
            ]}
          />
        </FormField>
        <FormField label="Difficulty">
          <FilterTabs
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: "none", label: "—" },
              { value: "easy", label: "Easy" },
              { value: "medium", label: "Medium" },
              { value: "hard", label: "Hard" },
            ]}
          />
        </FormField>
      </FormGrid>
      <FormField label="Prompt" htmlFor="question-prompt">
        <Textarea
          id="question-prompt"
          value={prompt}
          rows={3}
          autoFocus
          onChange={(event) => setPrompt(event.target.value)}
        />
      </FormField>
      {body.kind === "mcq" ? (
        <FormField label="Options">
          <RadioGroup
            value={String(body.correctIndex)}
            onValueChange={(value) =>
              setBody({ ...body, correctIndex: Number(value) })
            }
            className="gap-2"
          >
            {body.options.map((option, index) => (
              <div key={index} className="flex items-center gap-2">
                <RadioGroupItem
                  value={String(index)}
                  aria-label={`Option ${index + 1} is correct`}
                />
                <span className="w-4 text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <Input
                  value={option}
                  aria-label={`Option ${index + 1}`}
                  onChange={(event) =>
                    setBody({
                      ...body,
                      options: body.options.map((entry, at) =>
                        at === index ? event.target.value : entry,
                      ),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove option ${index + 1}`}
                  disabled={body.options.length <= 2}
                  onClick={() =>
                    setBody({
                      ...body,
                      options: body.options.filter((_, at) => at !== index),
                      correctIndex:
                        body.correctIndex === index
                          ? 0
                          : body.correctIndex > index
                            ? body.correctIndex - 1
                            : body.correctIndex,
                    })
                  }
                >
                  <X />
                </Button>
              </div>
            ))}
          </RadioGroup>
          {body.options.length < 6 ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="self-start"
              onClick={() =>
                setBody({ ...body, options: [...body.options, ""] })
              }
            >
              <Plus /> Option
            </Button>
          ) : null}
        </FormField>
      ) : body.kind === "true-false" ? (
        <FormField label="Answer">
          <FilterTabs
            value={body.correct ? "true" : "false"}
            onChange={(value) =>
              setBody({ ...body, correct: value === "true" })
            }
            options={[
              { value: "true", label: "True" },
              { value: "false", label: "False" },
            ]}
          />
        </FormField>
      ) : (
        <FormField label="Reference answer" htmlFor="question-reference">
          <Textarea
            id="question-reference"
            value={body.reference}
            rows={4}
            onChange={(event) =>
              setBody({ ...body, reference: event.target.value })
            }
          />
        </FormField>
      )}
      <FormField label="Explanation" htmlFor="question-explanation">
        <Textarea
          id="question-explanation"
          value={explanation}
          rows={3}
          onChange={(event) => setExplanation(event.target.value)}
        />
      </FormField>
    </FormDialog>
  );
}

export function answerText(body: QuestionBody): string {
  if (body.kind === "mcq") return body.options[body.correctIndex] ?? "—";
  if (body.kind === "true-false") return body.correct ? "True" : "False";
  return body.reference;
}

export function QuestionRow({
  question,
  index,
  onOpen,
  trailing,
}: {
  question: Question;
  index?: number;
  onOpen?: () => void;
  trailing?: ReactNode;
}) {
  return (
    <ListRow
      onClick={onOpen}
      leading={
        index !== undefined ? (
          <span className="text-xs tabular-nums">{index + 1}</span>
        ) : undefined
      }
      title={question.prompt}
      description={answerText(question.body)}
      meta={
        <>
          {question.stale ? <Badge variant="warning">stale</Badge> : null}
          {question.wrongCount > 0 ? (
            <span>
              <span className="sr-only">wrong </span>×{question.wrongCount}
            </span>
          ) : null}
          {question.difficulty ? (
            <span className="hidden w-14 capitalize sm:inline">
              {question.difficulty}
            </span>
          ) : null}
          <span className="w-10 text-right">
            {QUESTION_KIND_LABEL[question.body.kind]}
          </span>
        </>
      }
      trailing={trailing}
    />
  );
}
