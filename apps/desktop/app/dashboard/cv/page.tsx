"use client";

import { CvPage, CvSkeleton } from "@repo/admin/cv/cv-page";
import { AdminProvider } from "@repo/admin/provider";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

export default function CvRoute() {
  const { value, loading } = useDesktopAdmin();

  return (
    <AdminProvider value={value}>
      {loading ? <CvSkeleton /> : <CvPage />}
    </AdminProvider>
  );
}
