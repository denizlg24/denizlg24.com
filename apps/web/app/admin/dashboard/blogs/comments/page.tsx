import { BlogCommentsPage } from "@repo/admin/blog/blog-comments-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Comments | Admin Dashboard",
  description: "Moderate blog comments",
};

export default function BlogCommentsRoute() {
  return (
    <AdminFeatureShell>
      <BlogCommentsPage />
    </AdminFeatureShell>
  );
}
