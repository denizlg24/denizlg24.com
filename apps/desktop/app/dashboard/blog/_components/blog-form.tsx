"use client";

import { Copy, ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MarkdownRenderer } from "@/components/markdown/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { denizApi } from "@/lib/api-wrapper";
import type { IBlog } from "@/lib/data-types";

interface BlogFormProps {
  mode: "create" | "edit";
  blog?: IBlog;
  api: denizApi;
  onSuccess: (blog: IBlog) => void;
  onCancel?: () => void;
}

export function BlogForm({
  mode,
  blog,
  api,
  onSuccess,
  onCancel,
}: BlogFormProps) {
  const [title, setTitle] = useState(blog?.title ?? "");
  const [excerpt, setExcerpt] = useState(blog?.excerpt ?? "");
  const [content, setContent] = useState(blog?.content ?? "");
  const [tags, setTags] = useState<string[]>(blog?.tags ?? []);
  const [media, setMedia] = useState<string[]>(blog?.media ?? []);
  const [isActive, setIsActive] = useState(blog?.isActive ?? true);
  const [tagInput, setTagInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddTag = () => {
    const tag = tagInput.trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    setTags([...tags, tag]);
    setTagInput("");
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTag();
    }
  };

  const handleRemoveTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Only image files allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append("file", file);

    const result = await api.UPLOAD<{ url: string; hash: string }>({
      endpoint: "upload",
      formData,
    });

    if ("code" in result) {
      toast.error("Upload failed");
    } else {
      setMedia([...media, result.url]);
      toast.success("Image uploaded");
    }
    setUploadingMedia(false);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleRemoveMedia = (url: string) => {
    setMedia(media.filter((m) => m !== url));
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("URL copied");
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (!excerpt.trim()) {
      toast.error("Excerpt required");
      return;
    }
    if (!content.trim()) {
      toast.error("Content required");
      return;
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      excerpt: excerpt.trim(),
      content: content.trim(),
      tags,
      media,
      isActive,
    };

    if (mode === "create") {
      const result = await api.POST<{ message: string; blog: IBlog }>({
        endpoint: "blogs",
        body,
      });
      if ("code" in result) {
        toast.error("Failed to create post");
      } else {
        toast.success("Post created");
        onSuccess(result.blog);
      }
    } else if (blog) {
      const result = await api.PATCH<{ blog: IBlog }>({
        endpoint: `blogs/${blog._id}`,
        body,
      });
      if ("code" in result) {
        toast.error("Failed to update post");
      } else {
        toast.success("Post updated");
        onSuccess(result.blog);
      }
    }
    setSaving(false);
  };

  const canSubmit = title.trim() && excerpt.trim() && content.trim() && !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Post title"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Excerpt</Label>
          <Textarea
            value={excerpt}
            onChange={(e) => setExcerpt(e.target.value)}
            placeholder="Short description"
            rows={2}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Tags</Label>
        <div className="flex items-center gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            placeholder="Add tag..."
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={handleAddTag}
            disabled={!tagInput.trim()}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {tags.map((tag) => (
              <Badge
                key={tag}
                variant="secondary"
                className="text-xs gap-1 pr-1"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(tag)}
                  className="hover:text-destructive transition-colors"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Media</Label>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleMediaUpload}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-fit text-xs gap-1.5"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingMedia}
        >
          {uploadingMedia ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          {uploadingMedia ? "Uploading..." : "Upload Image"}
        </Button>
        {media.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {media.map((url) => (
              <div
                key={url}
                className="relative group rounded-md overflow-hidden border"
              >
                <img src={url} alt="" className="w-full h-24 object-cover" />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopyUrl(url)}
                    className="p-1.5 rounded-md bg-background/80 hover:bg-background"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveMedia(url)}
                    className="p-1.5 rounded-md bg-background/80 hover:bg-background text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Content (Markdown)</Label>
        <Tabs defaultValue="write">
          <TabsList variant="line" className="mb-2">
            <TabsTrigger value="write">Write</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="write">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Write your post in markdown..."
              rows={20}
              className="font-mono text-sm"
            />
          </TabsContent>
          <TabsContent value="preview">
            {content.trim() ? (
              <div className="rounded-md border p-4 min-h-[300px] overflow-y-auto">
                <MarkdownRenderer content={content} />
              </div>
            ) : (
              <div className="rounded-md border p-4 min-h-[300px] flex items-center justify-center text-muted-foreground text-sm">
                Nothing to preview
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Separator />

      <div className="flex items-center gap-2">
        <Checkbox
          id="publish"
          checked={isActive}
          onCheckedChange={(checked) => setIsActive(checked === true)}
        />
        <Label htmlFor="publish" className="text-xs cursor-pointer">
          Publish immediately
        </Label>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {mode === "create" ? "Create Post" : "Save Changes"}
        </Button>
        {onCancel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            onClick={onCancel}
            disabled={saving}
          >
            Cancel
          </Button>
        )}
      </div>
    </div>
  );
}
