import { NotesPage } from "@repo/admin/notes/notes-page";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export default function NotesRoute() {
  return (
    <AdminFeatureShell>
      <NotesPage />
    </AdminFeatureShell>
  );
}
