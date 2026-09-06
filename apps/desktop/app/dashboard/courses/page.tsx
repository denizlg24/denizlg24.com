"use client";

import { CoursesPage } from "@repo/admin/courses/courses-page";
import { AdminQueryRoute } from "@/components/admin-route";

export default function CoursesRoute() {
  return (
    <AdminQueryRoute>
      {(params) => <CoursesPage courseId={params.get("id") ?? undefined} />}
    </AdminQueryRoute>
  );
}
