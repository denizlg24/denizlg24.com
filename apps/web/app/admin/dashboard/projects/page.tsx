import { ProjectsPage } from "@repo/admin/projects/projects-page";
import type { Metadata } from "next";
import { AdminFeatureShell } from "../_components/admin-feature-shell";

export const metadata: Metadata = {
  title: "Projects | Admin Dashboard",
  description: "Manage portfolio projects",
};

export default function ProjectsRoute() {
  return (
    <AdminFeatureShell>
      <ProjectsPage newHref="/admin/dashboard/projects/new" />
    </AdminFeatureShell>
  );
}
