"use client";

import { DeckPage } from "@repo/admin/study/deck-page";
import { NotebookPage } from "@repo/admin/study/notebook-page";
import { NotebooksPage } from "@repo/admin/study/notebooks-page";
import { QuizPage } from "@repo/admin/study/quiz-page";
import { ReviewPage } from "@repo/admin/study/review-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function StudyRoute() {
  return (
    <AdminQueryRoute>
      {(params) => {
        const id = params.get("id");
        if (!id) return <NotebooksPage />;
        const deckId = params.get("deck") ?? undefined;
        if (params.get("review")) {
          return (
            <ReviewPage
              key={`${id}:${deckId ?? ""}`}
              notebookId={id}
              deckId={deckId}
            />
          );
        }
        if (deckId) {
          return <DeckPage key={deckId} notebookId={id} deckId={deckId} />;
        }
        const quizId = params.get("quiz");
        if (quizId) {
          return <QuizPage key={quizId} notebookId={id} quizId={quizId} />;
        }
        return (
          <NotebookPage key={id} notebookId={id} tab={params.get("tab")} />
        );
      }}
    </AdminQueryRoute>
  );
}
