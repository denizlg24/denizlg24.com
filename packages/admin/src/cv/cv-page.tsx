"use client";

import { LatexEditor, type LatexProject } from "@repo/latex-editor";
import { createDefaultLatexProject } from "@repo/latex-editor/project";
import type { CvResponse, ICvFile } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton } from "@repo/ui/skeleton-blocks";
import { ExternalLink, FileUser, Loader2, RefreshCw } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AdminApiError } from "../client";
import { useAdmin } from "../provider";

// react-pdf pulls in pdfjs (pdf.mjs) which throws when evaluated during SSR, so
// the preview loads client-only.
const CvPdfPreview = dynamic(() => import("./cv-pdf-preview"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-80 items-center justify-center">
      <Loader2 className="size-4 animate-spin text-muted-foreground" />
    </div>
  ),
});

interface CompileCvResponse extends CvResponse {
  log: string;
}

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
    <div className="flex h-full flex-col gap-2">
      <HeaderBarSkeleton
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
        actions={["w-20"]}
      />
      <div className="flex flex-1 flex-col gap-3 px-4 pt-3 pb-4">
        <Skeleton className="h-4 w-56" />
        <Skeleton className="min-h-[620px] w-full flex-1 rounded-lg" />
      </div>
    </div>
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
    <div className="flex h-full flex-col gap-2 pb-4">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<FileUser className="size-4 text-muted-foreground" />}
        title="CV"
      >
        {cv && (
          <div className="hidden items-baseline gap-2 text-[10px] text-muted-foreground md:flex">
            <span className="font-medium text-foreground">{cv.filename}</span>
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
          size="sm"
          className="h-8 text-xs"
          disabled={refreshing}
          onClick={() => {
            setRefreshing(true);
            void fetchCv();
          }}
        >
          <RefreshCw className={refreshing ? "animate-spin" : ""} />
          Refresh
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 px-4 pt-1">
        <LatexEditor
          project={project}
          onChange={setProject}
          onSave={async (nextProject) => {
            const result = await client.put<CvResponse>("cv", nextProject);
            setProject(result.project ?? nextProject);
            toast.success("Source saved");
          }}
          onCompile={async (nextProject) => {
            try {
              const result = await client.post<CompileCvResponse>(
                "cv/compile",
                nextProject,
              );
              setCv(result.cv);
              setDraft(result.draft);
              setProject(result.project ?? nextProject);
              toast.success("CV compiled");
              return { log: result.log };
            } catch (error) {
              if (error instanceof AdminApiError) {
                const log = error.details?.log;
                if (typeof log === "string" && log.trim()) {
                  throw new Error(log);
                }
              }
              throw error;
            }
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
      </div>
    </div>
  );
}
