"use client";

import { usePoll } from "@repo/cloud-ui/use-poll";
import { NativeSelect } from "@repo/ui/native-select";
import { Skeleton } from "@repo/ui/skeleton";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { ApiKeysSection } from "@/components/namespace/api-keys-section";
import { CollectionsSection } from "@/components/namespace/collections-section";
import { VectorIndexesSection } from "@/components/namespace/vector-indexes-section";
import { PageHeading } from "@/components/page-heading";
import { api } from "@/lib/api";

/**
 * The namespace half of a project: its API keys, the collections it syncs into
 * Meilisearch and the vector indexes on its Mongo database.
 *
 * Top-level and picker-driven rather than a tab under `/[project]` for two
 * reasons. Twelve projects hold a database and no deployable, so `/[project]`
 * — which resolves a deploy target from the slug — cannot reach them at all.
 * And none of this hangs off a single resource: a collection reads from
 * postgres or mongo and writes to meilisearch, and a vector index is
 * configured against the project's mongo database, so neither belongs on a
 * resource detail page either.
 */
function NamespacePanel() {
  const router = useRouter();
  const params = useSearchParams();
  const selected = params.get("project");

  const fetchProjects = useCallback(() => api.deploy.projects(), []);
  const { data: projects, error } = usePoll(fetchProjects, null);

  const projectId =
    selected ?? (projects && projects.length > 0 ? projects[0].id : null);

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!projects) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeading title="keys">
        <NativeSelect
          size="sm"
          value={projectId ?? ""}
          className="w-56 text-xs"
          onChange={(event) =>
            router.replace(`?project=${event.target.value}`, { scroll: false })
          }
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.slug}
              {project.hasTarget ? "" : " (no deployable)"}
            </option>
          ))}
        </NativeSelect>
      </PageHeading>

      {projectId ? (
        <>
          <ApiKeysSection projectId={projectId} />
          <CollectionsSection projectId={projectId} />
          <VectorIndexesSection projectId={projectId} />
        </>
      ) : (
        <p className="text-xs text-muted-foreground">—</p>
      )}
    </div>
  );
}

export default function KeysPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <NamespacePanel />
    </Suspense>
  );
}
