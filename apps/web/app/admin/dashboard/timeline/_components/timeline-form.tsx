"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@repo/ui/dialog";
import { Field, FieldError, FieldLabel } from "@repo/ui/field";
import { Input } from "@repo/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import {
  ExternalLink,
  NotepadText,
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

const timelineSchema = z.object({
  title: z.string().min(2, "Title must be at least 2 characters"),
  subtitle: z.string().min(2, "Subtitle must be at least 2 characters"),
  logoUrl: z.string().optional(),
  dateFrom: z.string().min(1, "Start date is required"),
  dateTo: z.string().optional(),
  category: z
    .enum(["work", "education", "personal"])
    .refine((val) => val !== undefined, {
      message: "Category is required",
    }),
  topics: z
    .array(z.string().min(1, "Topic cannot be empty"))
    .min(1, "At least one topic is required"),
  links: z
    .array(
      z.object({
        label: z.string().min(1, "Link label is required"),
        url: z.url("Must be a valid URL"),
        icon: z.enum(["external", "github", "notepad"]),
      }),
    )
    .optional(),
  isActive: z.boolean(),
});

type TimelineFormValues = z.infer<typeof timelineSchema>;

interface TimelineFormProps {
  initialData?: Partial<TimelineFormValues> & { _id?: string };
  mode: "create" | "edit";
}

export const TimelineForm = ({ initialData, mode }: TimelineFormProps) => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [logoPreview, setLogoPreview] = useState<string | null>(
    initialData?.logoUrl || null,
  );
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [errorDialog, setErrorDialog] = useState<string | null>(null);
  const [successDialog, setSuccessDialog] = useState(false);

  const {
    control,
    handleSubmit,
    setError,
    setValue,
    watch,
    formState: { errors },
  } = useForm<TimelineFormValues>({
    resolver: zodResolver(timelineSchema),
    defaultValues: {
      title: initialData?.title || "",
      subtitle: initialData?.subtitle || "",
      logoUrl: initialData?.logoUrl || "",
      dateFrom: initialData?.dateFrom || "",
      dateTo: initialData?.dateTo || "",
      category: initialData?.category || "work",
      topics: initialData?.topics || [""],
      links: initialData?.links || [],
      isActive: initialData?.isActive ?? true,
    },
  });

  const topics = watch("topics");
  const links = watch("links");

  const addTopic = () => {
    const currentTopics = watch("topics") || [];
    setValue("topics", [...currentTopics, ""]);
  };

  const removeTopic = (index: number) => {
    const currentTopics = watch("topics") || [];
    setValue(
      "topics",
      currentTopics.filter((_, i) => i !== index),
    );
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

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("logoUrl", { message: "Please upload an image file" });
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      setError("logoUrl", { message: "Image must be less than 5MB" });
      return;
    }

    setUploadingLogo(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/admin/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      setValue("logoUrl", data.url);
      setLogoPreview(data.url);
    } catch (_error) {
      setError("logoUrl", { message: "Failed to upload logo" });
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = () => {
    setValue("logoUrl", "");
    setLogoPreview(null);
  };

  const onSubmit = async (values: TimelineFormValues) => {
    setIsLoading(true);

    try {
      const url =
        mode === "edit"
          ? `/api/admin/timeline/${initialData?._id}`
          : "/api/admin/timeline";

      const method = mode === "edit" ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || `Failed to ${mode} timeline item`);
      }

      setSuccessDialog(true);
    } catch (error: any) {
      setErrorDialog(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSuccessClose = () => {
    setSuccessDialog(false);
    router.push("/admin/dashboard/timeline");
  };

  return (
    <>
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="w-full flex flex-col gap-6 mt-6"
      >
        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="title">Title</FieldLabel>
          <Controller
            name="title"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                id="title"
                placeholder="e.g. Ocean Informatix"
              />
            )}
          />
          {errors.title && <FieldError>{errors.title.message}</FieldError>}
        </Field>

        <Field data-invalid={!!errors.subtitle}>
          <FieldLabel htmlFor="subtitle">Subtitle</FieldLabel>
          <Controller
            name="subtitle"
            control={control}
            render={({ field }) => (
              <Input
                {...field}
                id="subtitle"
                placeholder="e.g. Co-founder & Lead Software Engineer"
              />
            )}
          />
          {errors.subtitle && (
            <FieldError>{errors.subtitle.message}</FieldError>
          )}
        </Field>

        <Field data-invalid={!!errors.logoUrl}>
          <FieldLabel htmlFor="logo">Logo (optional)</FieldLabel>
          <div className="flex flex-col gap-2">
            {logoPreview ? (
              <div className="relative w-24 h-24 rounded-lg overflow-hidden border-2 border-accent">
                <Image
                  src={logoPreview}
                  alt="Logo preview"
                  fill
                  className="object-cover"
                />
                <button
                  type="button"
                  onClick={removeLogo}
                  className="absolute top-1 right-1 p-1 bg-destructive rounded-full hover:bg-destructive/80 transition-colors"
                >
                  <X className="w-3 h-3 text-white" />
                </button>
              </div>
            ) : (
              <label className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-accent rounded-lg cursor-pointer hover:border-foreground transition-colors w-fit">
                <Upload className="w-4 h-4" />
                <span className="text-sm">
                  {uploadingLogo ? "Uploading..." : "Upload Logo"}
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleLogoUpload}
                  className="hidden"
                  disabled={uploadingLogo}
                />
              </label>
            )}
          </div>
          {errors.logoUrl && <FieldError>{errors.logoUrl.message}</FieldError>}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={!!errors.dateFrom}>
            <FieldLabel htmlFor="dateFrom">Start Date</FieldLabel>
            <Controller
              name="dateFrom"
              control={control}
              render={({ field }) => (
                <Input {...field} id="dateFrom" placeholder="e.g. Jan 2024" />
              )}
            />
            {errors.dateFrom && (
              <FieldError>{errors.dateFrom.message}</FieldError>
            )}
          </Field>

          <Field data-invalid={!!errors.dateTo}>
            <FieldLabel htmlFor="dateTo">End Date (optional)</FieldLabel>
            <Controller
              name="dateTo"
              control={control}
              render={({ field }) => (
                <Input
                  {...field}
                  id="dateTo"
                  placeholder="Leave empty for 'Present'"
                />
              )}
            />
            {errors.dateTo && <FieldError>{errors.dateTo.message}</FieldError>}
          </Field>
        </div>

        <Field data-invalid={!!errors.category}>
          <FieldLabel htmlFor="category">Category</FieldLabel>
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="work">Work</SelectItem>
                  <SelectItem value="education">Education</SelectItem>
                  <SelectItem value="personal">Personal</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          {errors.category && (
            <FieldError>{errors.category.message}</FieldError>
          )}
        </Field>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <FieldLabel>Topics / Experience Points</FieldLabel>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addTopic}
            >
              <Plus className="w-4 h-4 mr-1" />
              Add Topic
            </Button>
          </div>
          <div className="flex flex-col gap-2">
            {topics?.map((_, index) => (
              <div key={index} className="flex gap-2 items-start">
                <div className="flex-1">
                  <Controller
                    name={`topics.${index}` as const}
                    control={control}
                    render={({ field }) => (
                      <Textarea
                        {...field}
                        placeholder="Describe your experience or achievement"
                        rows={2}
                      />
                    )}
                  />
                  {errors.topics?.[index] && (
                    <FieldError>{errors.topics[index]?.message}</FieldError>
                  )}
                </div>
                {topics && topics.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTopic(index)}
                    className="mt-1"
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
          {errors.topics && !Array.isArray(errors.topics) && (
            <FieldError>{errors.topics.message}</FieldError>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <FieldLabel>Links (optional)</FieldLabel>
            <Button type="button" variant="outline" size="sm" onClick={addLink}>
              <Plus className="w-4 h-4 mr-1" />
              Add Link
            </Button>
          </div>
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
        </div>

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

        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={() => router.back()}
            disabled={isLoading}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            size="lg"
            disabled={isLoading}
            className="flex-1"
          >
            {isLoading
              ? `${mode === "edit" ? "Updating" : "Creating"}...`
              : mode === "edit"
                ? "Update"
                : "Create"}
          </Button>
        </div>
      </form>

      <Dialog open={!!errorDialog} onOpenChange={() => setErrorDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Error</DialogTitle>
            <DialogDescription>{errorDialog}</DialogDescription>
          </DialogHeader>
          <Button onClick={() => setErrorDialog(null)}>Close</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={successDialog} onOpenChange={handleSuccessClose}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Success</DialogTitle>
            <DialogDescription>
              Timeline item {mode === "edit" ? "updated" : "created"}{" "}
              successfully!
            </DialogDescription>
          </DialogHeader>
          <Button onClick={handleSuccessClose}>Close</Button>
        </DialogContent>
      </Dialog>
    </>
  );
};
