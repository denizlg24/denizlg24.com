"use client";

import {
  parseKnowledgeSourceKey,
  type Question,
  type QuizAttempt,
  type QuizDetail,
  type QuizResponse,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { Kbd } from "@repo/ui/kbd";
import { List, ListRow } from "@repo/ui/list";
import { Meter } from "@repo/ui/meter";
import { Page, PageBody, PageHeader, PageTitle } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { StatusDot } from "@repo/ui/status-dot";
import { Textarea } from "@repo/ui/textarea";
import { RowActions } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { ClipboardList, Play, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { answerText, QuestionDialog, QuestionRow } from "./question-editor";
import {
  deleteQuiz,
  getQuiz,
  submitQuizAttempt,
  updateQuiz,
} from "./study-api";
import {
  errorMessage,
  formatDuration,
  openStudySource,
  percent,
  relativeTime,
  SOURCE_KIND_ICON,
  withParam,
} from "./study-format";

type Mode =
  | { kind: "overview" }
  | { kind: "run"; order: string[]; startedAt: string }
  | { kind: "results"; attempt: QuizAttempt };

function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    const held = copy[index];
    const other = copy[swap];
    if (held === undefined || other === undefined) continue;
    copy[index] = other;
    copy[swap] = held;
  }
  return copy;
}

function responseText(question: Question, response: QuizResponse | null) {
  if (response === null) return "—";
  if (question.body.kind === "mcq" && typeof response === "number") {
    return question.body.options[response] ?? "—";
  }
  if (typeof response === "boolean") return response ? "True" : "False";
  return String(response);
}

function isAnswered(response: QuizResponse | null | undefined): boolean {
  if (response === null || response === undefined) return false;
  return typeof response === "string" ? Boolean(response.trim()) : true;
}

function QuizRunner({
  questions,
  timeLimitSec,
  submitting,
  onSubmit,
  onCancel,
}: {
  questions: Question[];
  timeLimitSec?: number;
  submitting: boolean;
  onSubmit: (responses: Record<string, QuizResponse | null>) => void;
  onCancel: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [responses, setResponses] = useState<
    Record<string, QuizResponse | null>
  >({});
  const startedAt = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const submitted = useRef(false);

  const question = questions[index];
  const last = index === questions.length - 1;
  const remainingMs = timeLimitSec
    ? Math.max(0, timeLimitSec * 1000 - (now - startedAt.current))
    : null;

  const finish = useCallback(() => {
    if (submitted.current) return;
    submitted.current = true;
    onSubmit(responses);
  }, [onSubmit, responses]);

  useEffect(() => {
    if (!timeLimitSec) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [timeLimitSec]);

  useEffect(() => {
    if (remainingMs === 0) finish();
  }, [finish, remainingMs]);

  const answer = useCallback(
    (value: QuizResponse | null) => {
      if (!question) return;
      setResponses((current) => ({ ...current, [question._id]: value }));
    },
    [question],
  );

  const next = useCallback(() => {
    if (last) finish();
    else setIndex((current) => current + 1);
  }, [finish, last]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!question) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      const modified = event.metaKey || event.ctrlKey;
      if (event.key === "Enter" && (!typing || modified)) {
        event.preventDefault();
        next();
        return;
      }
      if (typing || modified || event.altKey) return;
      if (event.key === "ArrowLeft" && index > 0) {
        setIndex(index - 1);
        return;
      }
      if (event.key === "ArrowRight" && !last) {
        setIndex(index + 1);
        return;
      }
      if (question.body.kind === "mcq") {
        const choice = Number(event.key) - 1;
        if (
          Number.isInteger(choice) &&
          choice >= 0 &&
          choice < question.body.options.length
        ) {
          event.preventDefault();
          answer(choice);
        }
      } else if (question.body.kind === "true-false") {
        if (event.key === "t" || event.key === "1") answer(true);
        if (event.key === "f" || event.key === "2") answer(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, index, last, next, question]);

  if (!question) return null;
  const response = responses[question._id];
  const answeredCount = questions.filter((entry) =>
    isAnswered(responses[entry._id]),
  ).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-4 border-b px-4 text-xs tabular-nums text-muted-foreground">
        <span>
          <span className="text-accent-strong">{index + 1}</span>/
          {questions.length}
        </span>
        <Meter
          value={answeredCount / questions.length}
          className="max-w-48 flex-1"
        />
        <span>{answeredCount} answered</span>
        <span className="flex-1" />
        {remainingMs !== null ? (
          <span
            className={cn(
              "font-medium",
              remainingMs < 60_000
                ? "text-status-critical"
                : "text-accent-strong",
            )}
            role="timer"
          >
            {formatDuration(remainingMs)}
          </span>
        ) : null}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Quit
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-12">
          <p className="whitespace-pre-wrap text-lg leading-relaxed text-accent-strong">
            {question.prompt}
          </p>
          {question.body.kind === "mcq" ? (
            <div role="radiogroup" className="flex flex-col gap-1">
              {question.body.options.map((option, at) => (
                <button
                  key={at}
                  type="button"
                  role="radio"
                  aria-checked={response === at}
                  onClick={() => answer(at)}
                  className={cn(
                    "-mx-3 flex items-baseline gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none",
                    response === at && "bg-surface text-accent-strong",
                  )}
                >
                  <Kbd>{at + 1}</Kbd>
                  <span className="min-w-0 flex-1">{option}</span>
                </button>
              ))}
            </div>
          ) : question.body.kind === "true-false" ? (
            <div role="radiogroup" className="flex gap-2">
              {([true, false] as const).map((value) => (
                <button
                  key={String(value)}
                  type="button"
                  role="radio"
                  aria-checked={response === value}
                  onClick={() => answer(value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-md py-3 text-sm transition-colors hover:bg-surface/70 focus-visible:bg-surface/70 focus-visible:outline-none",
                    response === value && "bg-surface text-accent-strong",
                  )}
                >
                  {value ? "True" : "False"}
                  <Kbd>{value ? "T" : "F"}</Kbd>
                </button>
              ))}
            </div>
          ) : (
            <Textarea
              rows={5}
              autoFocus
              aria-label="Answer"
              value={typeof response === "string" ? response : ""}
              onChange={(event) => answer(event.target.value)}
            />
          )}
        </div>
      </div>
      <div className="shrink-0 border-t">
        <div className="mx-auto flex w-full max-w-2xl items-center gap-2 px-6 py-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            Previous
          </Button>
          <span className="flex-1" />
          {!last ? (
            <Button variant="ghost" size="sm" onClick={finish}>
              Submit
            </Button>
          ) : null}
          <Button size="sm" disabled={submitting} onClick={next}>
            {last ? "Submit" : "Next"}
            <Kbd className="hidden sm:inline-flex">↵</Kbd>
          </Button>
        </div>
      </div>
    </div>
  );
}

function AttemptResults({
  attempt,
  questions,
  onRetry,
}: {
  attempt: QuizAttempt;
  questions: Question[];
  onRetry: () => void;
}) {
  const admin = useAdmin();
  const byId = useMemo(
    () => new Map(questions.map((question) => [question._id, question])),
    [questions],
  );
  const correct = attempt.answers.filter((answer) => answer.correct).length;
  return (
    <PageBody width="narrow">
      <div className="flex items-end gap-6">
        <span className="font-calistoga text-5xl tabular-nums text-accent-strong">
          {percent(attempt.score)}
        </span>
        <div className="flex flex-col gap-0.5 pb-1.5 text-xs tabular-nums text-muted-foreground">
          <span>
            {correct}/{attempt.answers.length} correct
          </span>
          <span>
            {formatDuration(attempt.durationMs)} ·{" "}
            {relativeTime(attempt.finishedAt)}
          </span>
        </div>
        <span className="flex-1" />
        <Button size="sm" variant="outline" onClick={onRetry}>
          <Play /> Again
        </Button>
      </div>
      <ol className="flex flex-col divide-y divide-border/70">
        {attempt.answers.map((answer, index) => {
          const question = byId.get(answer.questionId);
          if (!question) return null;
          const partial = !answer.correct && answer.credit > 0;
          return (
            <li key={answer.questionId} className="flex flex-col gap-2 py-4">
              <div className="flex items-baseline gap-3">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <StatusDot
                  tone={
                    answer.correct ? "good" : partial ? "warning" : "critical"
                  }
                  label={
                    answer.correct ? "correct" : partial ? "partial" : "wrong"
                  }
                  className="translate-y-[-1px]"
                />
                <p className="min-w-0 flex-1 whitespace-pre-wrap text-sm text-accent-strong">
                  {question.prompt}
                </p>
                {partial ? (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {percent(answer.credit)}
                  </span>
                ) : null}
              </div>
              <dl className="ml-[3.25rem] grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Yours</dt>
                <dd
                  className={cn(
                    "whitespace-pre-wrap",
                    answer.correct
                      ? "text-accent-strong"
                      : "text-status-critical",
                  )}
                >
                  {responseText(question, answer.response)}
                </dd>
                {!answer.correct ? (
                  <>
                    <dt className="text-muted-foreground">Answer</dt>
                    <dd className="whitespace-pre-wrap text-accent-strong">
                      {answerText(question.body)}
                    </dd>
                  </>
                ) : null}
                {answer.feedback ? (
                  <>
                    <dt className="text-muted-foreground">Feedback</dt>
                    <dd className="whitespace-pre-wrap">{answer.feedback}</dd>
                  </>
                ) : null}
                {question.explanation ? (
                  <>
                    <dt className="text-muted-foreground">Why</dt>
                    <dd className="whitespace-pre-wrap text-muted-foreground">
                      {question.explanation}
                    </dd>
                  </>
                ) : null}
                {question.sources.length > 0 ? (
                  <>
                    <dt className="text-muted-foreground">Sources</dt>
                    <dd className="flex flex-wrap gap-x-3 gap-y-1">
                      {question.sources.map((source) => {
                        const parsed = parseKnowledgeSourceKey(
                          source.sourceKey,
                        );
                        return (
                          <button
                            key={source.chunkId}
                            type="button"
                            onClick={() => void openStudySource(admin, source)}
                            className="inline-flex items-center gap-1 text-muted-foreground underline-offset-2 hover:text-accent-strong hover:underline [&_svg]:size-3"
                          >
                            {parsed ? SOURCE_KIND_ICON[parsed.kind] : null}
                            {parsed?.kind ?? "source"}
                          </button>
                        );
                      })}
                      {question.stale ? (
                        <span className="text-status-warning">stale</span>
                      ) : null}
                    </dd>
                  </>
                ) : null}
              </dl>
            </li>
          );
        })}
      </ol>
    </PageBody>
  );
}

function RenameQuizDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: string;
  onSubmit: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial);
  const [pending, setPending] = useState(false);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename quiz"
      submitDisabled={!title.trim()}
      pending={pending}
      onSubmit={async () => {
        setPending(true);
        try {
          await onSubmit(title.trim());
          onOpenChange(false);
        } finally {
          setPending(false);
        }
      }}
    >
      <FormField label="Title" htmlFor="quiz-rename">
        <Input
          id="quiz-rename"
          value={title}
          autoFocus
          onChange={(event) => setTitle(event.target.value)}
        />
      </FormField>
    </FormDialog>
  );
}

export function QuizPage({
  notebookId,
  quizId,
}: {
  notebookId: string;
  quizId: string;
}) {
  const { client, routes, slots } = useAdmin();
  const router = useRouter();
  const [detail, setDetail] = useState<QuizDetail | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>({ kind: "overview" });
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        setDetail(await getQuiz(client, quizId, { signal }));
      } catch (error) {
        if (signal?.aborted) return;
        setFailed(true);
        toast.error(errorMessage(error, "Failed to load quiz"));
      }
    },
    [client, quizId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const quizzesHref = withParam(
    routes.study.notebook(notebookId),
    "tab",
    "quizzes",
  );

  const questionsById = useMemo(
    () =>
      new Map(
        (detail?.questions ?? []).map((question) => [question._id, question]),
      ),
    [detail],
  );
  const ordered = useMemo(
    () =>
      (detail?.quiz.questionIds ?? []).flatMap((id) => {
        const question = questionsById.get(id);
        return question ? [question] : [];
      }),
    [detail, questionsById],
  );

  const crumbs = [
    { label: "Study", onClick: () => router.push(routes.study.index) },
    { label: "Quizzes", onClick: () => router.push(quizzesHref) },
  ];

  if (!detail) {
    return (
      <Page>
        <PageHeader
          leading={slots?.sidebarTrigger}
          crumbs={crumbs}
          icon={<ClipboardList />}
          title={failed ? "Quiz" : <Skeleton className="h-4 w-32" />}
        />
        {failed ? (
          <p className="py-16 text-center text-sm text-muted-foreground">—</p>
        ) : (
          <PageBody width="narrow">
            <Skeleton className="h-8 w-1/2" />
            <div className="flex flex-col gap-3">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-9 w-full" />
              ))}
            </div>
          </PageBody>
        )}
      </Page>
    );
  }

  const { quiz, attempts } = detail;

  const start = () => {
    const ids = ordered.map((question) => question._id);
    setMode({
      kind: "run",
      order: quiz.settings.shuffle ? shuffled(ids) : ids,
      startedAt: new Date().toISOString(),
    });
  };

  const submit = async (
    startedAt: string,
    order: string[],
    responses: Record<string, QuizResponse | null>,
  ) => {
    setSubmitting(true);
    try {
      const attempt = await submitQuizAttempt(client, quizId, {
        startedAt,
        answers: order.map((questionId) => ({
          questionId,
          response: isAnswered(responses[questionId])
            ? (responses[questionId] ?? null)
            : null,
        })),
      });
      setMode({ kind: "results", attempt });
      void load();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to submit attempt"));
    } finally {
      setSubmitting(false);
    }
  };

  const setQuestionIds = async (questionIds: string[]) => {
    if (questionIds.length === 0) return;
    try {
      await updateQuiz(client, quizId, { questionIds });
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update quiz"));
    }
  };

  const remove = async () => {
    try {
      await deleteQuiz(client, quizId);
      router.push(quizzesHref);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete quiz"));
    }
  };

  if (mode.kind === "run") {
    const runQuestions = mode.order.flatMap((id) => {
      const question = questionsById.get(id);
      return question ? [question] : [];
    });
    return (
      <Page>
        <PageHeader
          leading={slots?.sidebarTrigger}
          crumbs={crumbs}
          icon={<ClipboardList />}
          title={quiz.title}
        />
        <div className="min-h-0 flex-1">
          <QuizRunner
            questions={runQuestions}
            timeLimitSec={quiz.settings.timeLimitSec}
            submitting={submitting}
            onSubmit={(responses) =>
              void submit(mode.startedAt, mode.order, responses)
            }
            onCancel={() => setMode({ kind: "overview" })}
          />
        </div>
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={crumbs}
        icon={<ClipboardList />}
        title={quiz.title}
      >
        {mode.kind === "results" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMode({ kind: "overview" })}
          >
            Questions
          </Button>
        ) : null}
        <Button size="sm" disabled={ordered.length === 0} onClick={start}>
          <Play /> Start
        </Button>
        <RowActions>
          <DropdownMenuItem onSelect={() => setRenaming(true)}>
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() =>
              void updateQuiz(client, quizId, {
                settings: { shuffle: !quiz.settings.shuffle },
              })
                .then(() => load())
                .catch((error: unknown) =>
                  toast.error(errorMessage(error, "Failed to update quiz")),
                )
            }
          >
            {quiz.settings.shuffle ? "Don't shuffle" : "Shuffle"}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => void remove()}
          >
            Delete
          </DropdownMenuItem>
        </RowActions>
      </PageHeader>

      {mode.kind === "results" ? (
        <AttemptResults
          attempt={mode.attempt}
          questions={detail.questions}
          onRetry={start}
        />
      ) : (
        <PageBody width="narrow">
          <PageTitle
            title={quiz.title}
            meta={
              <>
                <span className="tabular-nums">{ordered.length} questions</span>
                {quiz.settings.timeLimitSec ? (
                  <span className="tabular-nums">
                    {formatDuration(quiz.settings.timeLimitSec * 1000)}
                  </span>
                ) : null}
                {quiz.settings.shuffle ? <span>shuffled</span> : null}
                <span className="tabular-nums">
                  best {percent(quiz.bestScore)}
                </span>
                <span className="tabular-nums">
                  last {percent(quiz.lastScore)}
                </span>
              </>
            }
          />
          <Section
            title="Questions"
            count={ordered.length}
            actions={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditing("new")}
              >
                <Plus /> Question
              </Button>
            }
          >
            {ordered.length === 0 ? (
              <EmptyState compact label="No questions" />
            ) : (
              <List divided>
                {ordered.map((question, index) => (
                  <QuestionRow
                    key={question._id}
                    question={question}
                    index={index}
                    onOpen={() => setEditing(question)}
                    trailing={
                      <RowActions>
                        <DropdownMenuItem onSelect={() => setEditing(question)}>
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={index === 0}
                          onSelect={() => {
                            const ids = [...quiz.questionIds];
                            const at = ids.indexOf(question._id);
                            const before = ids[at - 1];
                            if (at <= 0 || before === undefined) return;
                            ids[at - 1] = question._id;
                            ids[at] = before;
                            void setQuestionIds(ids);
                          }}
                        >
                          Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          disabled={ordered.length <= 1}
                          onSelect={() =>
                            void setQuestionIds(
                              quiz.questionIds.filter(
                                (id) => id !== question._id,
                              ),
                            )
                          }
                        >
                          Remove from quiz
                        </DropdownMenuItem>
                      </RowActions>
                    }
                  />
                ))}
              </List>
            )}
          </Section>
          <Section title="Attempts" count={attempts.length}>
            {attempts.length === 0 ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : (
              <List divided>
                {attempts.map((attempt) => (
                  <ListRow
                    key={attempt._id}
                    onClick={() => setMode({ kind: "results", attempt })}
                    title={percent(attempt.score)}
                    meta={
                      <>
                        <span>
                          {attempt.answers.filter((a) => a.correct).length}/
                          {attempt.answers.length}
                        </span>
                        <span className="w-12 text-right">
                          {formatDuration(attempt.durationMs)}
                        </span>
                        <span className="w-16 text-right">
                          {relativeTime(attempt.finishedAt)}
                        </span>
                      </>
                    }
                  />
                ))}
              </List>
            )}
          </Section>
        </PageBody>
      )}

      {editing ? (
        <QuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          notebookId={notebookId}
          question={editing === "new" ? null : editing}
          onSaved={(saved) => {
            if (editing === "new") {
              void setQuestionIds([...quiz.questionIds, saved._id]);
            } else {
              void load();
            }
          }}
        />
      ) : null}
      {renaming ? (
        <RenameQuizDialog
          open
          onOpenChange={setRenaming}
          initial={quiz.title}
          onSubmit={async (title) => {
            try {
              await updateQuiz(client, quizId, { title });
              await load();
            } catch (error) {
              toast.error(errorMessage(error, "Failed to rename quiz"));
            }
          }}
        />
      ) : null}
    </Page>
  );
}
