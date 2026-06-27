import { BlogPage } from "@repo/admin/blog/blog-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Blog Posts | Admin Dashboard",
  description: "Manage blog posts",
};

export default function BlogsRoute() {
  return (
    <AdminFeatureShell>
      <BlogPage newHref="/admin/dashboard/blogs/new" />
    </AdminFeatureShell>
  );
}
