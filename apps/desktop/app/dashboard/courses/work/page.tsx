"use client";

import { CourseworkEditorPage } from "@repo/admin/courses/coursework-editor-page";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { AdminQueryRoute } from "@/components/admin-route";

/** `?id=` is the course; `?workId=` is absent when adding a new row. */
export default function CourseworkRoute() {
  return (
    <AdminQueryRoute>
      {(params) => (
        <Coursework courseId={params.get("id")} workId={params.get("workId")} />
      )}
    </AdminQueryRoute>
  );
}

function Coursework({
  courseId,
  workId,
}: {
  courseId: string | null;
  workId: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!courseId) router.replace("/dashboard/courses");
  }, [courseId, router]);

  if (!courseId) return null;

  return (
    <CourseworkEditorPage courseId={courseId} workId={workId ?? undefined} />
  );
}
