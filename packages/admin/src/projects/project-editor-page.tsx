"use client";

import type { IProject } from "@repo/schemas";
import { FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DetailNotFound,
  DetailPageShell,
  DetailPageSkeleton,
} from "../detail-page-shell";
import { useAdmin } from "../provider";
import { ProjectForm } from "./project-form";

const ICON = <FolderGit2 className="size-4 text-muted-foreground" />;

export function ProjectEditorPage({
  mode,
  projectId,
}: {
  mode: "create" | "edit";
  projectId?: string;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const backTo = routes.projects.root;

  const [project, setProject] = useState<IProject | null>(null);
  const [loading, setLoading] = useState(mode === "edit");

  const load = useCallback(async () => {
    if (mode !== "edit" || !projectId) return;
    setLoading(true);
    try {
      const result = await client.get<{ project: IProject }>(
        `projects/${projectId}`,
      );
      setProject(result.project);
    } catch {
      toast.error("Failed to load project");
      setProject(null);
    } finally {
      setLoading(false);
    }
  }, [client, projectId, mode]);

  useEffect(() => {
    void load();
  }, [load]);

  const title = mode === "edit" ? "Edit Project" : "New Project";
  const shell = { icon: ICON, backTo, backLabel: "Projects" } as const;

  if (loading) return <DetailPageSkeleton {...shell} title={title} rows={2} />;

  if (mode === "edit" && !project) {
    return (
      <DetailNotFound
        {...shell}
        title="Project not found"
        message="This project could not be loaded."
      />
    );
  }

  return (
    <DetailPageShell
      {...shell}
      title={mode === "edit" ? project?.title : title}
    >
      <ProjectForm
        mode={mode}
        project={project ?? undefined}
        onSuccess={() => router.push(backTo)}
        onCancel={() => router.push(backTo)}
      />
    </DetailPageShell>
  );
}
