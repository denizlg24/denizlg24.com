"use client";

import type { INowPage } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { cn } from "@repo/ui/utils";
import { Clock, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  formatRelativeDate,
  MarkdownSection,
} from "../projects/document-editor";
import { useAdmin } from "../provider";

const ICON = <Clock />;

function NowHeader({ children }: { children?: ReactNode }) {
  const { slots } = useAdmin();
  return (
    <PageHeader leading={slots?.sidebarTrigger} icon={ICON} title="Now">
      {children}
    </PageHeader>
  );
}

export function NowSkeleton() {
  return (
    <Page>
      <NowHeader />
      <PageBody width="narrow">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
          <Skeleton className="h-4 w-3/5" />
        </div>
      </PageBody>
    </Page>
  );
}

export function NowPage() {
  const { client } = useAdmin();

  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);

  const fetchNowPage = useCallback(async () => {
    try {
      const result = await client.get<{ item: INowPage | null }>("now-page");
      if (result.item) {
        setContent(result.item.content);
        setOriginalContent(result.item.content);
        setUpdatedAt(result.item.updatedAt);
      }
    } catch {
      toast.error("Failed to load now page");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [client]);

  useEffect(() => {
    void fetchNowPage();
  }, [fetchNowPage]);

  const hasChanges = content !== originalContent;

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const result = await client.put<INowPage>("now-page", { content });
      setOriginalContent(content);
      setUpdatedAt(result.updatedAt);
      toast.success("Now page updated");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <NowSkeleton />;

  return (
    <Page>
      <NowHeader>
        {updatedAt ? (
          <span className="px-1 text-xs tabular-nums text-muted-foreground">
            {hasChanges ? "Edited" : formatRelativeDate(updatedAt)}
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Refresh"
          disabled={refreshing || hasChanges}
          onClick={() => {
            setRefreshing(true);
            void fetchNowPage();
          }}
        >
          <RefreshCw className={cn(refreshing && "animate-spin")} />
        </Button>
        <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving}>
          {saving ? <Spinner className="size-3.5" /> : null}
          Save
        </Button>
      </NowHeader>

      <PageBody width="narrow">
        <MarkdownSection title="Now" value={content} onChange={setContent} />
      </PageBody>
    </Page>
  );
}
