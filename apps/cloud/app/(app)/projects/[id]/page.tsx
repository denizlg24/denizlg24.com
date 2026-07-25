"use client";

import { Unreachable } from "@repo/cloud-ui/unreachable";
import { usePoll } from "@repo/cloud-ui/use-poll";
import { Button } from "@repo/ui/button";
import { Skeleton } from "@repo/ui/skeleton";
import { TypedConfirmDialog } from "@repo/ui/typed-confirm-dialog";
import { ArrowUpRight, Trash2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { STORAGE_APP_URL } from "@/lib/env";
import { ApiKeysSection } from "./_components/api-keys-section";
import { CollectionsSection } from "./_components/collections-section";
import { DatabasesSection } from "./_components/databases-section";
import { S3CredentialsSection } from "./_components/s3-credentials-section";
import { SearchTokenSection } from "./_components/search-token-section";
import { VectorIndexesSection } from "./_components/vector-indexes-section";

export default function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const projectId = params.id;

  const fetchProject = useCallback(
    () => api.projects.get(projectId),
    [projectId],
  );
  const {
    data: project,
    error,
    unreachable,
    loading,
    reload,
  } = usePoll(fetchProject, null);

  if (unreachable) {
    return <Unreachable retrying={loading} onRetry={() => void reload()} />;
  }
  if (error) {
    return <p className="text-xs text-destructive">{error}</p>;
  }
  if (!project) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-semibold leading-tight">
            {project.name}
          </h1>
          <p className="font-mono text-xs text-muted-foreground">
            {project.slug}
            {project.description && (
              <span className="ml-2 font-sans">{project.description}</span>
            )}
          </p>
        </div>
        {project.storageFolderId && (
          <Button variant="outline" size="sm" asChild>
            <a
              href={`${STORAGE_APP_URL}/folders/${project.storageFolderId}`}
              target="_blank"
              rel="noreferrer"
            >
              storage
              <ArrowUpRight className="size-3.5" />
            </a>
          </Button>
        )}
        <TypedConfirmDialog
          trigger={
            <Button
              aria-label={`Delete project ${project.name}`}
              variant="ghost"
              size="icon"
              className="size-8 text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          }
          title={`Delete project ${project.name}?`}
          keyword={project.slug}
          actionLabel="Delete project"
          onConfirm={async () => {
            try {
              await api.projects.remove(project.id);
              router.replace("/projects");
            } catch (err) {
              toast.error(errorMessage(err));
            }
          }}
        />
      </div>

      <ApiKeysSection projectId={projectId} />
      <S3CredentialsSection projectId={projectId} />
      <DatabasesSection projectId={projectId} />
      <CollectionsSection projectId={projectId} />
      <VectorIndexesSection projectId={projectId} />
      <SearchTokenSection project={project} />
    </div>
  );
}
