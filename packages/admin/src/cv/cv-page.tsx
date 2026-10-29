"use client";

import { LatexEditor, type LatexProject } from "@repo/latex-editor";
import { createDefaultLatexProject } from "@repo/latex-editor/project";
import type { CvResponse, ICvFile } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Page, PageBody } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { ExternalLink, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { compileOverStream } from "../latex/compile-stream";
import { useAdmin } from "../provider";

// react-pdf pulls in pdfjs (pdf.mjs) which throws when evaluated during SSR, so
// the preview loads client-only.
const CvPdfPreview = dynamic(() => import("./cv-pdf-preview"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-80 items-center justify-center">
      <Spinner className="size-4 text-muted-foreground" />
    </div>
  ),
});

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatUpdatedAt(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CvSkeleton() {
  return (
    <Page>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <Skeleton className="size-7" />
        <Skeleton className="size-7" />
        <Skeleton className="h-4 w-24" />
        <div className="flex-1" />
        <Skeleton className="hidden h-4 w-40 md:block" />
        <Skeleton className="size-7" />
        <Skeleton className="h-7 w-20" />
      </div>
      <PageBody bleed className="flex">
        <Skeleton className="hidden h-full w-56 rounded-none border-r md:block" />
        <Skeleton className="h-full flex-1 rounded-none opacity-60" />
        <Skeleton className="hidden h-full flex-1 rounded-none border-l lg:block" />
      </PageBody>
    </Page>
  );
}

export function CvPage() {
  const { client, platform, slots } = useAdmin();
  const [cv, setCv] = useState<ICvFile | null>(null);
  const [draft, setDraft] = useState<ICvFile | null>(null);
  const [project, setProject] = useState<LatexProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCv = useCallback(async () => {
    try {
      const result = await client.get<CvResponse>("cv");
      setCv(result.cv);
      setDraft(result.draft);
      setProject(result.project ?? createDefaultLatexProject());
    } catch {
      setProject((current) => current ?? createDefaultLatexProject());
      toast.error("Failed to load CV");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchCv();
  }, [fetchCv]);

  if (loading || !project) return <CvSkeleton />;

  return (
    <Page>
      <PageBody bleed className="flex">
        <LatexEditor
          className="h-full min-h-0 rounded-none border-0"
          headerLeading={slots?.sidebarTrigger}
          headerTrailing={
            <>
              {cv && (
                <div className="mr-1 hidden items-baseline gap-2 text-xs text-muted-foreground md:flex">
                  <span className="text-accent-strong">{cv.filename}</span>
                  <span className="tabular-nums">
                    {formatBytes(cv.size)} · {formatUpdatedAt(cv.updatedAt)}
                  </span>
                </div>
              )}
              {cv && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open CV"
                  onClick={() => platform.openExternal(cv.url)}
                >
                  <ExternalLink />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Refresh"
                disabled={refreshing}
                onClick={() => {
                  setRefreshing(true);
                  void fetchCv();
                }}
              >
                <RefreshCw className={refreshing ? "animate-spin" : ""} />
              </Button>
            </>
          }
          project={project}
          onChange={setProject}
          onSave={async (nextProject) => {
            const result = await client.put<CvResponse>("cv", nextProject);
            setProject(result.project ?? nextProject);
            toast.success("Source saved");
          }}
          onCompile={async (nextProject, { onLog }) => {
            const result = await compileOverStream<CvResponse>(
              client,
              "cv/compile",
              nextProject,
              { onLog },
            );
            setCv(result.payload.cv);
            setDraft(result.payload.draft);
            setProject(result.payload.project ?? nextProject);
            toast.success("CV compiled");
            return { log: result.log };
          }}
          onPublish={async () => {
            const result = await client.post<CvResponse>("cv/publish", {});
            setCv(result.cv);
            setDraft(result.draft);
            setProject((current) => result.project ?? current);
            toast.success("CV published");
          }}
          canPublish={draft !== null}
          compileLabel="Compile"
          publishLabel="Publish"
          preview={
            <CvPdfPreview
              cv={cv}
              draft={draft}
              client={client}
              platform={platform}
            />
          }
        />
      </PageBody>
    </Page>
  );
}
