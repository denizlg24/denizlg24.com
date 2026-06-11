"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  Check,
  Copy,
  Eye,
  PenLine,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import * as z from "zod";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ILeanBlog } from "@/models/Blog";

const blogSchema = z.object({
  title: z.string().min(1, "Title is required"),
  excerpt: z.string().min(1, "Excerpt is required"),
  content: z.string().min(1, "Content is required"),
  isActive: z.boolean(),
});

type BlogFormData = z.infer<typeof blogSchema>;

interface BlogFormProps {
  blog?: ILeanBlog;
  mode: "create" | "edit";
}

export function BlogForm({ blog, mode }: BlogFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [media, setMedia] = useState<string[]>(blog?.media || []);
  const [tags, setTags] = useState<string[]>(blog?.tags || []);
  const [newTag, setNewTag] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    formState: { errors },
  } = useForm<BlogFormData>({
    resolver: zodResolver(blogSchema),
    defaultValues: {
      title: blog?.title || "",
      excerpt: blog?.excerpt || "",
      content: blog?.content || "",
      isActive: blog?.isActive !== undefined ? blog.isActive : true,
    },
  });

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert("Image must be less than 5MB");
      return;
    }

    setUploadingMedia(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload media");
      }

      const data = await response.json();
      setMedia([...media, data.url]);
    } catch (error) {
      console.error("Error uploading media:", error);
      alert("Failed to upload media. Please try again.");
    } finally {
      setUploadingMedia(false);
    }
  };

  const removeMedia = (index: number) => {
    setMedia(media.filter((_, i) => i !== index));
  };

  const copyToClipboard = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(url);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
      alert("Failed to copy URL to clipboard");
    }
  };

  const addTag = () => {
    if (newTag.trim() && !tags.includes(newTag.trim())) {
      setTags([...tags, newTag.trim()]);
      setNewTag("");
    }
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const onSubmit = async (data: BlogFormData) => {
    setLoading(true);

    try {
      const payload = {
        ...data,
        media,
        tags,
      };

      const url =
        mode === "create"
          ? "/api/admin/blogs"
          : `/api/admin/blogs/${blog?._id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${mode} blog`);
      }

      router.push("/admin/dashboard/blogs");
      router.refresh();
    } catch (error) {
      console.error(`Error ${mode}ing blog:`, error);
      alert(`Failed to ${mode} blog. Please try again.`);
    } finally {
      setLoading(false);
    }
  };

  const [togglePreview, setTogglePreview] = useState(false);

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 mt-6">
      <Field data-invalid={!!errors.title}>
        <FieldLabel htmlFor="title">Title</FieldLabel>
        <Input id="title" {...register("title")} />
        {errors.title && <FieldError>{errors.title.message}</FieldError>}
      </Field>

      <Field data-invalid={!!errors.excerpt}>
        <FieldLabel htmlFor="excerpt">Excerpt</FieldLabel>
        <Textarea id="excerpt" {...register("excerpt")} rows={2} />
        {errors.excerpt && <FieldError>{errors.excerpt.message}</FieldError>}
      </Field>

      <div className="flex flex-col gap-3">
        <FieldLabel>Tags</FieldLabel>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="gap-1">
                {tag}
                <button
                  type="button"
                  onClick={() => removeTag(tag)}
                  className="ml-1"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            placeholder="Add a tag"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" && (e.preventDefault(), addTag())
            }
          />
          <Button type="button" onClick={addTag} variant="outline">
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <FieldLabel>Media Gallery (for Markdown)</FieldLabel>
          <label htmlFor="media-upload">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingMedia}
              asChild
            >
              <span>
                <Upload className="w-4 h-4 mr-1" />
                {uploadingMedia ? "Uploading..." : "Upload Image"}
              </span>
            </Button>
            <input
              id="media-upload"
              type="file"
              accept="image/*"
              onChange={handleMediaUpload}
              className="hidden"
              disabled={uploadingMedia}
            />
          </label>
        </div>
        {media.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Click on a URL to copy it for use in your markdown content
            </p>
            <div className="grid grid-cols-1 gap-3">
              {media.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <div className="relative w-20 h-20 shrink-0 rounded overflow-hidden bg-background">
                    <Image
                      src={url}
                      alt={`Media ${index + 1}`}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <button
                      type="button"
                      onClick={() => copyToClipboard(url)}
                      className="w-full text-left font-mono text-xs p-2 rounded bg-background hover:bg-accent transition-colors truncate block"
                      title="Click to copy URL"
                    >
                      {url}
                    </button>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => copyToClipboard(url)}
                    className="shrink-0"
                  >
                    {copiedUrl === url ? (
                      <Check className="w-4 h-4 text-accent" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeMedia(index)}
                    className="shrink-0"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
        {media.length === 0 && (
          <div className="p-6 border-2 border-dashed border-muted rounded-lg text-center text-sm text-muted-foreground">
            No media uploaded yet. Upload images to use them in your markdown
            content.
          </div>
        )}
      </div>

      <Field data-invalid={!!errors.content}>
        <FieldLabel
          className="inline-flex items-center gap-2 w-full"
          htmlFor="content"
        >
          Content (Markdown)
          <Button
            onClick={() => {
              setTogglePreview((prev) => !prev);
            }}
            type="button"
            variant={"outline"}
            size={"icon-sm"}
          >
            {togglePreview ? <PenLine /> : <Eye />}
          </Button>
        </FieldLabel>
        {!togglePreview && (
          <Textarea
            id="content"
            {...register("content")}
            rows={20}
            className="font-mono text-sm min-h-96 max-h-[70vh] overflow-y-auto resize-none"
          />
        )}
        {togglePreview && (
          <div className="min-h-96 max-h-[70vh] overflow-y-auto w-full max-w-full! mx-auto rounded-md border bg-background px-6 sm:px-8 py-8 border-muted shadow-xs">
            <MarkdownRenderer content={watch("content") || ""} />
          </div>
        )}

        {errors.content && <FieldError>{errors.content.message}</FieldError>}
      </Field>

      <Field>
        <div className="flex items-center gap-2">
          <Controller
            name="isActive"
            control={control}
            render={({ field: { value, onChange, ...field } }) => (
              <Checkbox
                {...field}
                id="isActive"
                checked={value}
                onCheckedChange={onChange}
              />
            )}
          />
          <FieldLabel htmlFor="isActive" className="cursor-pointer">
            Active (visible on website)
          </FieldLabel>
        </div>
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading
            ? "Saving..."
            : mode === "create"
              ? "Create Blog"
              : "Update Blog"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
