import { EditCourseClient } from "./edit-course-client";

export default async function EditCourseRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <EditCourseClient courseId={id} />;
}
