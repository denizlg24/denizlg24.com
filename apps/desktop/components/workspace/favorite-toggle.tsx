"use client";

import { AdminProvider } from "@repo/admin/provider";
import { FavoriteToggle as WorkspaceFavoriteToggle } from "@repo/admin/workspace/favorite-toggle";
import { useDesktopAdmin } from "@/hooks/use-desktop-admin";

/** The title bar sits above the dashboard shell, so it brings its own provider. */
export function FavoriteToggle() {
  const { value } = useDesktopAdmin();
  return (
    <AdminProvider value={value}>
      <WorkspaceFavoriteToggle />
    </AdminProvider>
  );
}
