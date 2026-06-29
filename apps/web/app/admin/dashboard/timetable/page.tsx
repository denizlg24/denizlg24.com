import { TimetablePage } from "@repo/admin/timetable/timetable-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function TimetableRoute() {
  return (
    <AdminFeatureShell>
      <TimetablePage />
    </AdminFeatureShell>
  );
}
