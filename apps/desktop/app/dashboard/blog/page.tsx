"use client";

import { BlogPage, BlogSkeleton } from "@repo/admin/blog/blog-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function BlogRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <BlogSkeleton /> : <BlogPage newHref="/dashboard/blog/new" />}
    </AdminProvider>
  );
}
