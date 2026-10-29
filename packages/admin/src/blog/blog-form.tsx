"use client";

import type { IBlog } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { Properties, Property } from "@repo/ui/properties";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import { CalendarDays, Clock, Eye, Link2, Tag, Trash2 } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import {
  ChipInput,
  DocumentEditorShell,
  formatRelativeDate,
  ImagesSection,
  LeadField,
  MarkdownSection,
  TitleField,
} from "../projects/document-editor";
import { useAdmin } from "../provider";

interface BlogFormProps {
  mode: "create" | "edit";
  blog?: IBlog;
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  onSuccess: (blog: IBlog) => void;
  onDeleted?: () => void;
}

export function BlogForm({
  mode,
  blog,
  icon,
  backTo,
  backLabel,
  onSuccess,
  onDeleted,
}: BlogFormProps) {
  const { client } = useAdmin();
  const [title, setTitle] = useState(blog?.title ?? "");
  const [excerpt, setExcerpt] = useState(blog?.excerpt ?? "");
  const [content, setContent] = useState(blog?.content ?? "");
  const [tags, setTags] = useState<string[]>(blog?.tags ?? []);
  const [media, setMedia] = useState<string[]>(blog?.media ?? []);
  const [isActive, setIsActive] = useState(blog?.isActive ?? true);
  const [saving, setSaving] = useState(false);

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

    try {
      if (mode === "create") {
        const result = await client.post<{ message: string; blog: IBlog }>(
          "blogs",
          body,
        );
        toast.success("Post created");
        onSuccess(result.blog);
      } else if (blog) {
        const result = await client.patch<{ blog: IBlog }>(
          `blogs/${blog._id}`,
          body,
        );
        toast.success("Post updated");
        onSuccess(result.blog);
      }
    } catch {
      toast.error(
        mode === "create" ? "Failed to create post" : "Failed to update post",
      );
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!blog) return;
    try {
      await client.del<{ message: string }>(`blogs/${blog._id}`);
      toast.success("Post deleted");
      onDeleted?.();
    } catch {
      toast.error("Failed to delete post");
    }
  };

  const canSubmit =
    title.trim().length > 0 &&
    excerpt.trim().length > 0 &&
    content.trim().length > 0 &&
    !saving;

  return (
    <DocumentEditorShell
      icon={icon}
      backTo={backTo}
      backLabel={backLabel}
      title={mode === "edit" ? blog?.title || "Untitled" : "New post"}
      actions={
        <>
          {mode === "edit" && blog ? (
            <ConfirmButton
              trigger={
                <Button variant="ghost" size="icon-sm" aria-label="Delete post">
                  <Trash2 />
                </Button>
              }
              title="Delete post?"
              description={`“${blog.title}” will be permanently deleted.`}
              actionLabel="Delete"
              destructive
              onConfirm={handleDelete}
            />
          ) : null}
          <Button size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? <Spinner className="size-3.5" /> : null}
            {mode === "create" ? "Create" : "Save"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        <TitleField value={title} onChange={setTitle} />
        <LeadField
          value={excerpt}
          onChange={setExcerpt}
          placeholder="Excerpt"
          label="Excerpt"
        />
      </div>

      <Properties>
        <Property icon={<Eye />} label="Published">
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Published"
          />
        </Property>
        <Property icon={<Tag />} label="Tags">
          <ChipInput
            values={tags}
            onChange={setTags}
            placeholder="Add tag"
            normalize={(value) => value.trim().toLowerCase()}
          />
        </Property>
        {blog ? (
          <>
            <Property icon={<Link2 />} label="Slug">
              <span className="font-mono text-xs text-muted-foreground">
                /{blog.slug}
              </span>
            </Property>
            <Property icon={<Clock />} label="Read time">
              <span className="tabular-nums">{blog.timeToRead}m</span>
            </Property>
            <Property icon={<CalendarDays />} label="Created">
              <span className="text-muted-foreground">
                {formatRelativeDate(blog.createdAt)}
              </span>
            </Property>
          </>
        ) : null}
      </Properties>

      <ImagesSection
        title="Media"
        urls={media}
        onChange={setMedia}
        columns={2}
      />

      <MarkdownSection value={content} onChange={setContent} />
    </DocumentEditorShell>
  );
}
