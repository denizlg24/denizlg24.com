"use client";

import type { Deck, Question, Quiz } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { DropdownMenuItem } from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { FormDialog, FormField, FormGrid } from "@repo/ui/form-dialog";
import { Input } from "@repo/ui/input";
import { List, ListRow } from "@repo/ui/list";
import { Section } from "@repo/ui/section";
import { Skeleton } from "@repo/ui/skeleton";
import { Switch } from "@repo/ui/switch";
import { RowActions, SearchField } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { ClipboardList, Layers3, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { QuestionDialog, QuestionRow } from "./question-editor";
import {
  createDeck,
  createQuiz,
  deleteDeck,
  deleteQuiz,
  listQuestions,
  updateDeck,
} from "./study-api";
import { errorMessage, percent, relativeTime } from "./study-format";

export function DeckDialog({
  open,
  onOpenChange,
  notebookId,
  deck,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  deck: Deck | null;
  onSaved: (deck: Deck) => void;
}) {
  const { client } = useAdmin();
  const [title, setTitle] = useState(deck?.title ?? "");
  const [description, setDescription] = useState(deck?.description ?? "");
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setPending(true);
    try {
      onSaved(
        deck
          ? await updateDeck(client, deck._id, {
              title: trimmed,
              description: description.trim() || null,
            })
          : await createDeck(client, {
              notebookId,
              title: trimmed,
              ...(description.trim()
                ? { description: description.trim() }
                : {}),
            }),
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(errorMessage(error, "Failed to save deck"));
    } finally {
      setPending(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={deck ? "Edit deck" : "New deck"}
      onSubmit={submit}
      submitDisabled={!title.trim()}
      pending={pending}
    >
      <FormGrid>
        <FormField label="Title" htmlFor="deck-title">
          <Input
            id="deck-title"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField label="Description" htmlFor="deck-description">
          <Input
            id="deck-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </FormField>
      </FormGrid>
    </FormDialog>
  );
}

export function NotebookDecks({
  notebookId,
  decks,
  onChange,
}: {
  notebookId: string;
  decks: Deck[];
  onChange: () => void;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const [editing, setEditing] = useState<Deck | "new" | null>(null);

  const remove = async (deck: Deck) => {
    try {
      await deleteDeck(client, deck._id);
      onChange();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete deck"));
    }
  };

  const totals = decks.reduce(
    (sum, deck) => ({
      cards: sum.cards + deck.cardCount,
      due: sum.due + deck.dueCount,
      fresh: sum.fresh + deck.newCount,
    }),
    { cards: 0, due: 0, fresh: 0 },
  );

  return (
    <Section
      title="Decks"
      count={decks.length}
      actions={
        <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
          <Plus /> Deck
        </Button>
      }
    >
      {decks.length === 0 ? (
        <EmptyState compact icon={<Layers3 />} label="No decks" />
      ) : (
        <>
          <div className="-mx-2 flex items-center gap-3 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            <span className="flex-1" />
            <span className="flex items-center gap-2 tabular-nums">
              <span className="w-12 text-right">Cards</span>
              <span className="w-12 text-right">Due</span>
              <span className="w-12 text-right">New</span>
              <span className="hidden w-16 text-right sm:inline">Updated</span>
              <span className="w-[5.5rem]" />
            </span>
          </div>
          <List divided>
            {decks.map((deck) => (
              <ListRow
                key={deck._id}
                onClick={() =>
                  router.push(routes.study.deck(notebookId, deck._id))
                }
                leading={<Layers3 />}
                title={deck.title}
                description={deck.description}
                meta={
                  <>
                    <span className="w-12 text-right">{deck.cardCount}</span>
                    <span
                      className={cn(
                        "w-12 text-right",
                        deck.dueCount > 0 && "font-medium text-accent-strong",
                      )}
                    >
                      {deck.dueCount || "—"}
                    </span>
                    <span className="w-12 text-right">
                      {deck.newCount || "—"}
                    </span>
                    <span className="hidden w-16 text-right sm:inline">
                      {relativeTime(deck.updatedAt)}
                    </span>
                  </>
                }
                trailing={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={deck.dueCount + deck.newCount === 0}
                      onClick={() =>
                        router.push(routes.study.review(notebookId, deck._id))
                      }
                    >
                      Review
                    </Button>
                    <RowActions>
                      <DropdownMenuItem onSelect={() => setEditing(deck)}>
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void remove(deck)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </RowActions>
                  </>
                }
              />
            ))}
          </List>
          <p className="text-xs tabular-nums text-muted-foreground">
            {totals.cards} cards · {totals.due} due · {totals.fresh} new
          </p>
        </>
      )}
      {editing ? (
        <DeckDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          notebookId={notebookId}
          deck={editing === "new" ? null : editing}
          onSaved={() => onChange()}
        />
      ) : null}
    </Section>
  );
}

function NewQuizDialog({
  open,
  onOpenChange,
  notebookId,
  questions,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notebookId: string;
  questions: Question[];
  onCreated: (quiz: Quiz) => void;
}) {
  const { client } = useAdmin();
  const [title, setTitle] = useState("");
  const [chosen, setChosen] = useState<string[]>(() =>
    questions.map((question) => question._id),
  );
  const [shuffle, setShuffle] = useState(true);
  const [minutes, setMinutes] = useState("");
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? questions.filter((question) =>
          question.prompt.toLowerCase().includes(needle),
        )
      : questions;
  }, [query, questions]);

  const limit = Number(minutes);
  const limitValid =
    !minutes || (Number.isFinite(limit) && limit >= 0.5 && limit <= 240);

  const submit = async () => {
    if (!title.trim() || chosen.length === 0 || !limitValid) return;
    setPending(true);
    try {
      onCreated(
        await createQuiz(client, {
          notebookId,
          title: title.trim(),
          questionIds: chosen,
          settings: {
            shuffle,
            ...(minutes ? { timeLimitSec: Math.round(limit * 60) } : {}),
          },
        }),
      );
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create quiz"));
    } finally {
      setPending(false);
    }
  };

  const chosenSet = new Set(chosen);

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="New quiz"
      size="lg"
      onSubmit={submit}
      submitLabel="Create"
      submitDisabled={!title.trim() || chosen.length === 0 || !limitValid}
      pending={pending}
    >
      <FormGrid className="sm:grid-cols-[1fr_8rem_auto]">
        <FormField label="Title" htmlFor="quiz-title">
          <Input
            id="quiz-title"
            value={title}
            autoFocus
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <FormField
          label="Minutes"
          htmlFor="quiz-minutes"
          error={limitValid ? undefined : "0.5–240"}
        >
          <Input
            id="quiz-minutes"
            inputMode="decimal"
            value={minutes}
            placeholder="—"
            onChange={(event) => setMinutes(event.target.value)}
          />
        </FormField>
        <FormField label="Shuffle" htmlFor="quiz-shuffle">
          <div className="flex h-8 items-center">
            <Switch
              id="quiz-shuffle"
              checked={shuffle}
              onCheckedChange={setShuffle}
            />
          </div>
        </FormField>
      </FormGrid>
      <FormField label={`Questions · ${chosen.length}/${questions.length}`}>
        <div className="flex items-center gap-2">
          <SearchField value={query} onChange={setQuery} className="flex-1" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setChosen(
                chosen.length === questions.length
                  ? []
                  : questions.map((question) => question._id),
              )
            }
          >
            {chosen.length === questions.length ? "None" : "All"}
          </Button>
        </div>
        <div className="flex flex-col">
          {visible.map((question) => (
            <label
              key={question._id}
              className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface/70"
            >
              <Checkbox
                checked={chosenSet.has(question._id)}
                onCheckedChange={(checked) =>
                  setChosen((current) =>
                    checked === true
                      ? [...current, question._id]
                      : current.filter((id) => id !== question._id),
                  )
                }
              />
              <span className="min-w-0 flex-1 truncate text-accent-strong">
                {question.prompt}
              </span>
              {question.stale ? (
                <span className="text-xs text-status-warning">stale</span>
              ) : null}
            </label>
          ))}
        </div>
      </FormField>
    </FormDialog>
  );
}

export function NotebookQuizzes({
  notebookId,
  quizzes,
  onChange,
}: {
  notebookId: string;
  quizzes: Quiz[];
  onChange: () => void;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [editing, setEditing] = useState<Question | "new" | null>(null);
  const [creatingQuiz, setCreatingQuiz] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    listQuestions(client, notebookId, { signal: controller.signal })
      .then(setQuestions)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        toast.error(errorMessage(error, "Failed to load questions"));
        setQuestions([]);
      });
    return () => controller.abort();
  }, [client, notebookId]);

  const remove = async (quiz: Quiz) => {
    try {
      await deleteQuiz(client, quiz._id);
      onChange();
    } catch (error) {
      toast.error(errorMessage(error, "Failed to delete quiz"));
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Quizzes"
        count={quizzes.length}
        actions={
          <Button
            variant="ghost"
            size="sm"
            disabled={!questions || questions.length === 0}
            onClick={() => setCreatingQuiz(true)}
          >
            <Plus /> Quiz
          </Button>
        }
      >
        {quizzes.length === 0 ? (
          <EmptyState compact icon={<ClipboardList />} label="No quizzes" />
        ) : (
          <>
            <div className="-mx-2 flex items-center gap-3 px-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
              <span className="flex-1" />
              <span className="flex items-center gap-2">
                <span className="w-10 text-right">Qs</span>
                <span className="w-14 text-right">Attempts</span>
                <span className="w-12 text-right">Best</span>
                <span className="w-12 text-right">Last</span>
                <span className="hidden w-16 text-right sm:inline">
                  Updated
                </span>
                <span className="w-7" />
              </span>
            </div>
            <List divided>
              {quizzes.map((quiz) => (
                <ListRow
                  key={quiz._id}
                  onClick={() =>
                    router.push(routes.study.quiz(notebookId, quiz._id))
                  }
                  leading={<ClipboardList />}
                  title={quiz.title}
                  description={
                    quiz.settings.timeLimitSec
                      ? `${Math.round(quiz.settings.timeLimitSec / 60)} min`
                      : undefined
                  }
                  meta={
                    <>
                      <span className="w-10 text-right">
                        {quiz.questionIds.length}
                      </span>
                      <span className="w-14 text-right">
                        {quiz.attemptCount || "—"}
                      </span>
                      <span className="w-12 text-right">
                        {percent(quiz.bestScore)}
                      </span>
                      <span className="w-12 text-right">
                        {percent(quiz.lastScore)}
                      </span>
                      <span className="hidden w-16 text-right sm:inline">
                        {relativeTime(quiz.updatedAt)}
                      </span>
                    </>
                  }
                  trailing={
                    <RowActions>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void remove(quiz)}
                      >
                        Delete
                      </DropdownMenuItem>
                    </RowActions>
                  }
                />
              ))}
            </List>
          </>
        )}
      </Section>

      <Section
        title="Question bank"
        count={questions?.length}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setEditing("new")}>
            <Plus /> Question
          </Button>
        }
      >
        {questions === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-9 w-full" />
            ))}
          </div>
        ) : questions.length === 0 ? (
          <EmptyState compact label="No questions" />
        ) : (
          <List divided>
            {questions.map((question) => (
              <QuestionRow
                key={question._id}
                question={question}
                onOpen={() => setEditing(question)}
              />
            ))}
          </List>
        )}
      </Section>

      {editing ? (
        <QuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          notebookId={notebookId}
          question={editing === "new" ? null : editing}
          onSaved={(saved) =>
            setQuestions((current) => {
              const list = current ?? [];
              return list.some((entry) => entry._id === saved._id)
                ? list.map((entry) => (entry._id === saved._id ? saved : entry))
                : [saved, ...list];
            })
          }
          onDeleted={(questionId) =>
            setQuestions((current) =>
              (current ?? []).filter((entry) => entry._id !== questionId),
            )
          }
        />
      ) : null}
      {creatingQuiz && questions ? (
        <NewQuizDialog
          open
          onOpenChange={setCreatingQuiz}
          notebookId={notebookId}
          questions={questions}
          onCreated={(quiz) => {
            setCreatingQuiz(false);
            onChange();
            router.push(routes.study.quiz(notebookId, quiz._id));
          }}
        />
      ) : null}
    </div>
  );
}
