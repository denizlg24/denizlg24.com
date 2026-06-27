"use client";

import type { INowPage } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { PageHeader } from "@repo/ui/page-header";
import { Skeleton } from "@repo/ui/skeleton";
import { HeaderBarSkeleton, TabStripSkeleton } from "@repo/ui/skeleton-blocks";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import { Clock, Loader2, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAdmin } from "../provider";

function formatLastUpdated(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
}

export function NowSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2">
      <HeaderBarSkeleton
        icon={<Clock className="size-4 text-muted-foreground" />}
        title="Now Page"
        actions={["w-24", "w-20", "w-16"]}
      />
      <div className="px-4 flex min-h-0 flex-1 flex-col gap-4 pt-3 pb-4">
        <TabStripSkeleton widths={["w-12", "w-16"]} />
        <Skeleton className="w-full flex-1 rounded-md" />
      </div>
    </div>
  );
}

export function NowPage() {
  const { client, slots } = useAdmin();

  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchNowPage = useCallback(async () => {
    try {
      const result = await client.get<{ item: INowPage }>("now-page");
      if (result.item) {
        setContent(result.item.content);
        setOriginalContent(result.item.content);
        setUpdatedAt(result.item.updatedAt);
      }
    } catch {
      toast.error("Failed to load now page");
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    fetchNowPage();
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

  if (loading) {
    return <NowSkeleton />;
  }

  return (
    <div className="flex flex-col gap-2 pb-8 h-full">
      <PageHeader
        leading={slots?.sidebarTrigger}
        icon={<Clock className="size-4 text-muted-foreground" />}
        title="Now Page"
      >
        {updatedAt && (
          <span className="text-[10px] text-muted-foreground">
            Updated {formatLastUpdated(updatedAt)}
          </span>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() => {
            setLoading(true);
            fetchNowPage();
          }}
        >
          <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>

        <Button
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleSave}
          disabled={!hasChanges || saving}
        >
          {saving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Save className="size-3.5" />
          )}
          Save
        </Button>
      </PageHeader>

      <div className="px-4 flex flex-col gap-4 pt-3 flex-1 min-h-0 overflow-y-auto">
        <Tabs defaultValue="write" className="flex flex-col flex-1 min-h-0">
          <TabsList variant="line" className="mb-2">
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write" className="flex-1 min-h-0">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write what you're up to now in markdown..."
              className="font-mono text-sm h-full min-h-[400px] resize-none"
            />
          </TabsContent>
          <TabsContent value="preview" className="flex-1 min-h-0">
            {content.trim() ? (
              <div className="rounded-md border p-4 min-h-[400px] overflow-y-auto">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <div className="rounded-md border p-4 min-h-[400px] flex items-center justify-center text-muted-foreground text-sm">
                Nothing to preview
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
