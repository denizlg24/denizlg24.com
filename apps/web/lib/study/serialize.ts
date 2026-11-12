import type {
  Deck,
  Flashcard,
  FsrsCardState,
  Question,
  Quiz,
  QuizAttempt,
} from "@repo/schemas";
import type { ILeanDeck } from "@/models/Deck";
import type { IFlashcardFsrs, ILeanFlashcard } from "@/models/Flashcard";
import type { ILeanQuiz } from "@/models/Quiz";
import type { ILeanQuizAttempt } from "@/models/QuizAttempt";
import type { ILeanStudyQuestion } from "@/models/StudyQuestion";
import type { CardCounts } from "./counts";
import { isStale } from "./source-refs";

export function fsrsToWire(fsrs: IFlashcardFsrs): FsrsCardState {
  const wire: FsrsCardState = {
    due: fsrs.due.toISOString(),
    stability: fsrs.stability,
    difficulty: fsrs.difficulty,
    elapsedDays: fsrs.elapsedDays,
    scheduledDays: fsrs.scheduledDays,
    learningSteps: fsrs.learningSteps,
    reps: fsrs.reps,
    lapses: fsrs.lapses,
    state: fsrs.state,
  };
  if (fsrs.lastReview) wire.lastReview = fsrs.lastReview.toISOString();
  return wire;
}

export function fsrsFromWire(state: FsrsCardState): IFlashcardFsrs {
  return {
    due: new Date(state.due),
    stability: state.stability,
    difficulty: state.difficulty,
    elapsedDays: state.elapsedDays,
    scheduledDays: state.scheduledDays,
    learningSteps: state.learningSteps,
    reps: state.reps,
    lapses: state.lapses,
    state: state.state,
    ...(state.lastReview ? { lastReview: new Date(state.lastReview) } : {}),
  };
}

export function flashcardToWire(
  card: ILeanFlashcard,
  hashes: ReadonlyMap<string, string>,
): Flashcard {
  return {
    _id: String(card._id),
    deckId: String(card.deckId),
    notebookId: String(card.notebookId),
    front: card.front,
    back: card.back,
    sources: card.sources.map((source) => ({
      chunkId: source.chunkId,
      sourceKey: source.sourceKey,
      contentHash: source.contentHash,
    })),
    stale: isStale(card.sources, hashes),
    suspended: card.suspended,
    fsrs: fsrsToWire(card.fsrs),
    createdAt: card.createdAt.toISOString(),
    updatedAt: card.updatedAt.toISOString(),
  };
}

export function deckToWire(deck: ILeanDeck, counts?: CardCounts): Deck {
  return {
    _id: String(deck._id),
    notebookId: String(deck.notebookId),
    title: deck.title,
    ...(deck.description ? { description: deck.description } : {}),
    cardCount: counts?.total ?? 0,
    dueCount: counts?.due ?? 0,
    newCount: counts?.new ?? 0,
    createdAt: deck.createdAt.toISOString(),
    updatedAt: deck.updatedAt.toISOString(),
  };
}

export function questionToWire(
  question: ILeanStudyQuestion,
  hashes: ReadonlyMap<string, string>,
): Question {
  return {
    _id: String(question._id),
    notebookId: String(question.notebookId),
    prompt: question.prompt,
    body: question.body,
    ...(question.explanation ? { explanation: question.explanation } : {}),
    ...(question.difficulty ? { difficulty: question.difficulty } : {}),
    sources: question.sources.map((source) => ({
      chunkId: source.chunkId,
      sourceKey: source.sourceKey,
      contentHash: source.contentHash,
    })),
    stale: isStale(question.sources, hashes),
    wrongCount: question.wrongCount,
    createdAt: question.createdAt.toISOString(),
    updatedAt: question.updatedAt.toISOString(),
  };
}

export function quizToWire(quiz: ILeanQuiz): Quiz {
  return {
    _id: String(quiz._id),
    notebookId: String(quiz.notebookId),
    title: quiz.title,
    questionIds: quiz.questionIds.map(String),
    settings: {
      shuffle: quiz.settings.shuffle,
      ...(quiz.settings.timeLimitSec !== undefined
        ? { timeLimitSec: quiz.settings.timeLimitSec }
        : {}),
    },
    attemptCount: quiz.attemptCount,
    ...(quiz.bestScore !== undefined ? { bestScore: quiz.bestScore } : {}),
    ...(quiz.lastScore !== undefined ? { lastScore: quiz.lastScore } : {}),
    createdAt: quiz.createdAt.toISOString(),
    updatedAt: quiz.updatedAt.toISOString(),
  };
}

export function attemptToWire(attempt: ILeanQuizAttempt): QuizAttempt {
  return {
    _id: String(attempt._id),
    quizId: String(attempt.quizId),
    notebookId: String(attempt.notebookId),
    answers: attempt.answers.map((answer) => ({
      questionId: String(answer.questionId),
      response: answer.response ?? null,
      correct: answer.correct,
      credit: answer.credit,
      ...(answer.feedback ? { feedback: answer.feedback } : {}),
    })),
    score: attempt.score,
    startedAt: attempt.startedAt.toISOString(),
    finishedAt: attempt.finishedAt.toISOString(),
    durationMs: attempt.durationMs,
  };
}
