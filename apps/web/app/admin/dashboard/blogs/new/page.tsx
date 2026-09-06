import { BlogEditorPage } from "@repo/admin/blog/blog-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "New Post | Admin Dashboard",
};

export default function NewBlogRoute() {
  return (
    <AdminFeatureShell>
      <BlogEditorPage mode="create" />
    </AdminFeatureShell>
  );
}
