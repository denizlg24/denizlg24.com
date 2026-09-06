"use client";

import { BlogEditorPage } from "@repo/admin/blog/blog-editor-page";
import { AdminRecordRoute } from "@/components/admin-route";

export default function EditBlogRoute() {
  return (
    <AdminRecordRoute redirectTo="/dashboard/blog">
      {(id) => <BlogEditorPage mode="edit" blogId={id} />}
    </AdminRecordRoute>
  );
}
