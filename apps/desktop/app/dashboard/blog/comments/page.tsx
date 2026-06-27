"use client";

import {
  BlogCommentsPage,
  BlogCommentsSkeleton,
} from "@repo/admin/blog/blog-comments-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function BlogCommentsRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <BlogCommentsSkeleton /> : <BlogCommentsPage />}
    </AdminProvider>
  );
}
