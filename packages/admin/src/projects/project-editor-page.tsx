"use client";

import type { IProject } from "@repo/schemas";
import { FolderGit2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";
import { DocumentEditorSkeleton, DocumentNotFound } from "./document-editor";
import { ProjectForm } from "./project-form";

const ICON = <FolderGit2 />;

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

  const shell = { icon: ICON, backTo, backLabel: "Projects" } as const;

  if (loading) {
    return <DocumentEditorSkeleton {...shell} title="Project" properties={5} />;
  }

  if (mode === "edit" && !project) {
    return <DocumentNotFound {...shell} label="Project not found" />;
  }

  return (
    <ProjectForm
      key={project?._id ?? "new"}
      mode={mode}
      project={project ?? undefined}
      {...shell}
      onSuccess={() => router.push(backTo)}
      onDeleted={() => router.push(backTo)}
    />
  );
}
