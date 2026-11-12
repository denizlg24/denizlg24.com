import { QuizPage } from "@repo/admin/study/quiz-page";
import { AdminFeatureShell } from "../../../../_components/admin-feature-shell";

export default async function QuizRoute({
  params,
}: {
  params: Promise<{ id: string; quizId: string }>;
}) {
  const { id, quizId } = await params;
  return (
    <AdminFeatureShell>
      <QuizPage key={quizId} notebookId={id} quizId={quizId} />
    </AdminFeatureShell>
  );
}
