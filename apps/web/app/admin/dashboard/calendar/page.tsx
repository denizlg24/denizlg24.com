import { CalendarPage } from "@repo/admin/calendar/calendar-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Calendar | Admin Dashboard",
  description: "Manage calendar events",
};

export default function CalendarRoute() {
  return (
    <AdminFeatureShell>
      <CalendarPage />
    </AdminFeatureShell>
  );
}
