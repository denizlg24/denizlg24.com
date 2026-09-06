import { BlogEditorPage } from "@repo/admin/blog/blog-editor-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Edit Post | Admin Dashboard",
};

export default async function EditBlogRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AdminFeatureShell>
      <BlogEditorPage mode="edit" blogId={id} />
    </AdminFeatureShell>
  );
}
