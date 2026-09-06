"use client";

import { BlogEditorPage } from "@repo/admin/blog/blog-editor-page";
import { AdminRoute } from "@/components/admin-route";

export default function NewBlogRoute() {
  return (
    <AdminRoute>
      <BlogEditorPage mode="create" />
    </AdminRoute>
  );
}
