"use client";

import { Clock, Loader2, RefreshCw, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useUserSettings } from "@/context/user-context";
import { denizApi } from "@/lib/api-wrapper";
import type { INowPage } from "@/lib/data-types";

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

function NowPageLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Clock className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Now Page</span>
      </div>
      <div className="px-4 flex flex-col gap-4 pt-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-9 w-48 rounded-lg" />
        <Skeleton className="h-[300px] w-full rounded-md" />
      </div>
    </div>
  );
}

export default function NowPage() {
  const { settings, loading: loadingSettings } = useUserSettings();

  const api = useMemo(() => {
    if (loadingSettings) return null;
    return new denizApi(settings.apiKey);
  }, [settings, loadingSettings]);

  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchNowPage = useCallback(async () => {
    if (!api) return;
    const result = await api.GET<{ item: INowPage }>({
      endpoint: "now-page",
    });
    if (!("code" in result) && result.item) {
      setContent(result.item.content);
      setOriginalContent(result.item.content);
      setUpdatedAt(result.item.updatedAt);
    } else if ("code" in result) {
      toast.error("Failed to load now page");
    }
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchNowPage();
  }, [fetchNowPage]);

  const hasChanges = content !== originalContent;

  const handleSave = async () => {
    if (!api || !hasChanges) return;
    setSaving(true);

    const result = await api.PUT<INowPage>({
      endpoint: "now-page",
      body: { content },
    });

    if ("code" in result) {
      toast.error("Failed to save");
    } else {
      setOriginalContent(content);
      setUpdatedAt(result.updatedAt);
      toast.success("Now page updated");
    }
    setSaving(false);
  };

  if (loadingSettings || loading) {
    return <NowPageLoadingSkeleton />;
  }

  if (!api) {
    return (
      <div className="flex flex-col gap-2 pb-8">
        <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
          <Clock className="size-4 text-muted-foreground" />
          <span className="text-sm font-semibold flex-1">Now Page</span>
        </div>
        <div className="px-4 pt-12 text-center text-muted-foreground text-sm">
          Failed to initialize API client.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 pb-8 h-full">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Clock className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Now Page</span>

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
      </div>

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
