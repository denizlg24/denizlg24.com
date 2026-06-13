"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@repo/ui/field";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import {
  Check,
  Copy,
  ExternalLink,
  Eye,
  NotepadText,
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
import { FaGithub } from "react-icons/fa6";
import * as z from "zod";
import { MarkdownRenderer } from "@/components/markdown-renderer";
import type { ILeanProject } from "@/models/Project";

const projectSchema = z.object({
  title: z.string().min(1, "Title is required"),
  subtitle: z.string().min(1, "Subtitle is required"),
  markdown: z.string().min(1, "Content is required"),
  links: z
    .array(
      z.object({
        label: z.string().min(1, "Link label is required"),
        url: z.string().url("Must be a valid URL"),
        icon: z.enum(["external", "github", "notepad"]),
      }),
    )
    .optional(),
  isActive: z.boolean(),
  isFeatured: z.boolean(),
});

type ProjectFormData = z.infer<typeof projectSchema>;

interface ProjectFormProps {
  project?: ILeanProject;
  mode: "create" | "edit";
}

export function ProjectForm({ project, mode }: ProjectFormProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [images, setImages] = useState<string[]>(project?.images || []);
  const [media, setMedia] = useState<string[]>(project?.media || []);
  const [tags, setTags] = useState<string[]>(project?.tags || []);
  const [newTag, setNewTag] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    formState: { errors },
  } = useForm<ProjectFormData>({
    resolver: zodResolver(projectSchema),
    defaultValues: {
      title: project?.title || "",
      subtitle: project?.subtitle || "",
      markdown: project?.markdown || "",
      links: project?.links || [],
      isActive: project?.isActive !== undefined ? project.isActive : true,
      isFeatured:
        project?.isFeatured !== undefined ? project.isFeatured : false,
    },
  });

  const links = watch("links");

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingImage(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload image");
      }

      const data = await response.json();
      setImages([...images, data.url]);
    } catch (error) {
      console.error("Error uploading image:", error);
      alert("Failed to upload image. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  const removeImage = (index: number) => {
    setImages(images.filter((_, i) => i !== index));
  };

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

  const addLink = () => {
    const currentLinks = watch("links") || [];
    setValue("links", [
      ...currentLinks,
      { label: "", url: "", icon: "external" as const },
    ]);
  };

  const removeLink = (index: number) => {
    const currentLinks = watch("links") || [];
    setValue(
      "links",
      currentLinks.filter((_, i) => i !== index),
    );
  };

  const onSubmit = async (data: ProjectFormData) => {
    setLoading(true);

    try {
      const payload = {
        ...data,
        images,
        media,
        tags,
        links: (data.links || []).filter((link) => link.label && link.url),
      };

      const url =
        mode === "create"
          ? "/api/admin/projects"
          : `/api/admin/projects/${project?._id}`;
      const method = mode === "create" ? "POST" : "PATCH";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to ${mode} project`);
      }

      router.push("/admin/dashboard/projects");
      router.refresh();
    } catch (error) {
      console.error(`Error ${mode}ing project:`, error);
      alert(`Failed to ${mode} project. Please try again.`);
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

      <Field data-invalid={!!errors.subtitle}>
        <FieldLabel htmlFor="subtitle">Subtitle</FieldLabel>
        <Textarea id="subtitle" {...register("subtitle")} rows={2} />
        {errors.subtitle && <FieldError>{errors.subtitle.message}</FieldError>}
      </Field>

      <div className="flex flex-col gap-4">
        <Label>Images</Label>

        <div className="w-full flex flex-wrap items-center justify-start gap-2">
          {images.map((image, index) => (
            <div
              key={index}
              className="relative w-full max-w-[150px] aspect-video rounded-lg border-2 border-accent"
            >
              <Image
                src={image}
                alt={`Project image ${index + 1}`}
                fill
                className="object-cover rounded-lg"
              />
              <button
                type="button"
                onClick={() => removeImage(index)}
                className="absolute -top-2 -right-2 p-1 bg-destructive rounded-full hover:bg-destructive/80 transition-colors hover:cursor-pointer"
              >
                <X className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
          {images.length === 0 ? (
            <label className="flex flex-col text-center items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-accent rounded-lg cursor-pointer hover:border-foreground transition-colors w-full max-w-[150px] aspect-video">
              <Upload className="w-4 h-4" />
              <span className="text-sm">
                {uploadingImage ? "Uploading..." : "Upload Image"}
              </span>
              <input
                type="file"
                accept="image/*"
                onChange={handleImageUpload}
                className="hidden"
                disabled={uploadingImage}
              />
            </label>
          ) : (
            <div className="flex gap-2">
              <label className="flex flex-col text-center items-center justify-center gap-2 px-4 py-2 border-2 border-dashed border-accent rounded-lg cursor-pointer hover:border-foreground transition-colors w-full max-w-[150px] aspect-video">
                <Plus className="w-4 h-4" />
                <span className="text-sm">
                  {uploadingImage ? "Uploading..." : "Add More Images"}
                </span>
                <input
                  id="add-more-images"
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  disabled={uploadingImage}
                />
              </label>
            </div>
          )}
        </div>
      </div>

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
          <FieldLabel>Links (optional)</FieldLabel>
          <Button type="button" variant="outline" size="sm" onClick={addLink}>
            <Plus className="w-4 h-4 mr-1" />
            Add Link
          </Button>
        </div>
        {links && links.length > 0 && (
          <div className="flex flex-col gap-3">
            {links?.map((_, index) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1 w-full flex flex-row items-center gap-2">
                  <div className="w-1/3">
                    <Controller
                      name={`links.${index}.label` as const}
                      control={control}
                      render={({ field }) => (
                        <Input {...field} placeholder="Link label" />
                      )}
                    />
                    {errors.links?.[index]?.label && (
                      <FieldError>
                        {errors.links[index]?.label?.message}
                      </FieldError>
                    )}
                  </div>
                  <div className="grow">
                    <Controller
                      name={`links.${index}.url` as const}
                      control={control}
                      render={({ field }) => (
                        <Input {...field} placeholder="https://..." />
                      )}
                    />
                    {errors.links?.[index]?.url && (
                      <FieldError>
                        {errors.links[index]?.url?.message}
                      </FieldError>
                    )}
                  </div>
                  <div className="w-fit">
                    <Controller
                      name={`links.${index}.icon` as const}
                      control={control}
                      render={({ field }) => (
                        <Select
                          value={field.value}
                          onValueChange={field.onChange}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Icon" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="external">
                              <ExternalLink />
                            </SelectItem>
                            <SelectItem value="github">
                              <FaGithub />
                            </SelectItem>
                            <SelectItem value="notepad">
                              <NotepadText />
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    />
                    {errors.links?.[index]?.icon && (
                      <FieldError>
                        {errors.links[index]?.icon?.message}
                      </FieldError>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLink(index)}
                  className="mt-1"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
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

      <Field data-invalid={!!errors.markdown}>
        <FieldLabel
          className="inline-flex items-center gap-2 w-full"
          htmlFor="markdown"
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
            id="markdown"
            {...register("markdown")}
            rows={20}
            className="font-mono text-sm min-h-96 max-h-[70vh] overflow-y-auto resize-none"
          />
        )}
        {togglePreview && (
          <div className="min-h-96 max-h-[70vh] overflow-y-auto w-full max-w-full! mx-auto rounded-md border bg-background px-6 sm:px-8 py-8 border-muted shadow-xs">
            <MarkdownRenderer content={watch("markdown") || ""} />
          </div>
        )}

        {errors.markdown && <FieldError>{errors.markdown.message}</FieldError>}
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

      <Field>
        <div className="flex items-center gap-2">
          <Controller
            name="isFeatured"
            control={control}
            render={({ field: { value, onChange, ...field } }) => (
              <Checkbox
                {...field}
                id="isFeatured"
                checked={value}
                onCheckedChange={onChange}
              />
            )}
          />
          <FieldLabel htmlFor="isFeatured" className="cursor-pointer">
            Featured (displayed on homepage)
          </FieldLabel>
        </div>
      </Field>

      <div className="flex gap-2">
        <Button type="submit" disabled={loading}>
          {loading
            ? "Saving..."
            : mode === "create"
              ? "Create Project"
              : "Update Project"}
        </Button>
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
