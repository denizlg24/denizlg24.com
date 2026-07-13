"use client";

import { DEFAULT_PROJECT_TOPIC_GROUPS, type IProject } from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import { Input } from "@repo/ui/input";
import { Label } from "@repo/ui/label";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Separator } from "@repo/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui/tabs";
import { Textarea } from "@repo/ui/textarea";
import {
  Copy,
  ExternalLink,
  ImagePlus,
  Loader2,
  NotebookText,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import { toast } from "sonner";
import { TagAutocomplete } from "../notes/tag-autocomplete";
import { useAdmin } from "../provider";

const LINK_ICONS = [
  { value: "external" as const, label: "External", icon: ExternalLink },
  { value: "github" as const, label: "GitHub", icon: FaGithub },
  { value: "notepad" as const, label: "Notepad", icon: NotebookText },
];

interface ProjectFormProps {
  mode: "create" | "edit";
  project?: IProject;
  onSuccess: (project: IProject) => void;
  onCancel?: () => void;
}

export function ProjectForm({
  mode,
  project,
  onSuccess,
  onCancel,
}: ProjectFormProps) {
  const { client, platform } = useAdmin();
  const [title, setTitle] = useState(project?.title ?? "");
  const [subtitle, setSubtitle] = useState(project?.subtitle ?? "");
  const [markdown, setMarkdown] = useState(project?.markdown ?? "");
  const [images, setImages] = useState<string[]>(project?.images ?? []);
  const [media, setMedia] = useState<string[]>(project?.media ?? []);
  const [tags, setTags] = useState<string[]>(project?.tags ?? []);
  const [topicGroups, setTopicGroups] = useState<string[]>(
    project?.topicGroups ?? [],
  );
  const [topicSuggestions, setTopicSuggestions] = useState<string[]>([]);
  const [links, setLinks] = useState<
    { label: string; url: string; icon: "external" | "github" | "notepad" }[]
  >(
    project?.links?.map((l) => ({
      label: l.label,
      url: l.url,
      icon: l.icon,
    })) ?? [],
  );
  const [isActive, setIsActive] = useState(project?.isActive ?? true);
  const [isFeatured, setIsFeatured] = useState(project?.isFeatured ?? false);

  const [tagInput, setTagInput] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkIcon, setNewLinkIcon] = useState<
    "external" | "github" | "notepad"
  >("external");
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const mediaInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    let active = true;

    client
      .get<{ projects: IProject[] }>("projects")
      .then((result) => {
        if (!active) return;
        const topics = result.projects.flatMap(
          (item) => item.topicGroups ?? [],
        );
        setTopicSuggestions(topics);
      })
      .catch(() => {
        if (active) setTopicSuggestions([]);
      });

    return () => {
      active = false;
    };
  }, [client]);

  const topicOptions = useMemo(
    () =>
      [
        ...new Set([
          ...DEFAULT_PROJECT_TOPIC_GROUPS,
          ...topicSuggestions,
          ...topicGroups,
        ]),
      ].sort((left, right) => left.localeCompare(right)),
    [topicGroups, topicSuggestions],
  );

  const handleTopicGroupsChange = (next: string[]) => {
    setTopicGroups(next);
    setTopicSuggestions((current) =>
      [...new Set([...current, ...next])].sort((left, right) =>
        left.localeCompare(right),
      ),
    );
  };

  const handleUpload = async (
    file: File,
    setUploading: (v: boolean) => void,
    onUploaded: (url: string) => void,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be under 5MB");
      return;
    }

    setUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const result = await client.upload<{ url: string; hash: string }>(
        "upload",
        formData,
      );
      onUploaded(result.url);
      toast.success("Image uploaded");
    } catch {
      toast.error("Upload failed");
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleAddLink = () => {
    if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
    setLinks([
      ...links,
      { label: newLinkLabel.trim(), url: newLinkUrl.trim(), icon: newLinkIcon },
    ]);
    setNewLinkLabel("");
    setNewLinkUrl("");
    setNewLinkIcon("external");
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (!subtitle.trim()) {
      toast.error("Subtitle required");
      return;
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      markdown: markdown.trim(),
      images,
      media,
      tags,
      topicGroups,
      links,
      isActive,
      isFeatured,
    };

    try {
      if (mode === "create") {
        const result = await client.post<{
          message: string;
          project: IProject;
        }>("projects", body);
        toast.success("Project created");
        onSuccess(result.project);
      } else if (project) {
        const result = await client.patch<{ project: IProject }>(
          `projects/${project._id}`,
          body,
        );
        toast.success("Project updated");
        onSuccess(result.project);
      }
    } catch {
      toast.error(
        mode === "create"
          ? "Failed to create project"
          : "Failed to update project",
      );
    }
    setSaving(false);
  };

  const canSubmit = title.trim() && subtitle.trim() && !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Project title"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Subtitle</Label>
          <Input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Short description"
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
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
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

      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <Label className="text-xs">Topics</Label>
          <p className="text-xs text-muted-foreground">
            Manual project filter topics. These are not inferred from tags.
          </p>
        </div>
        <TagAutocomplete
          value={topicGroups}
          onChange={handleTopicGroupsChange}
          suggestions={topicOptions}
          placeholder="Add topic..."
          searchPlaceholder="Search or create topic..."
          emptyMessage="No topics found"
          groupHeading="Topics"
          noun="topic"
          normalizeValue={(value) => value.trim()}
          normalizeKey={(value) => value.trim().toLowerCase()}
        />
        {topicGroups.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {topicGroups.map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="gap-1 pr-1 text-xs"
              >
                {topic}
                <button
                  type="button"
                  onClick={() =>
                    handleTopicGroupsChange(
                      topicGroups.filter((item) => item !== topic),
                    )
                  }
                  className="transition-colors hover:text-destructive"
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
        <Label className="text-xs">Links</Label>
        <div className="flex flex-col gap-2">
          {links.map((link, i) => {
            const IconComp =
              LINK_ICONS.find((li) => li.value === link.icon)?.icon ??
              ExternalLink;
            return (
              <div
                key={i}
                className="flex items-center gap-2 text-xs border rounded-md px-2.5 py-1.5"
              >
                <IconComp className="size-3.5 text-muted-foreground shrink-0" />
                <span className="font-medium truncate">{link.label}</span>
                <span className="text-muted-foreground truncate flex-1">
                  {link.url}
                </span>
                <button
                  type="button"
                  onClick={() => setLinks(links.filter((_, idx) => idx !== i))}
                  className="hover:text-destructive transition-colors shrink-0"
                >
                  <X className="size-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex flex-col gap-2 mt-1 sm:flex-row sm:items-end">
          <div className="flex flex-col gap-1 sm:flex-1">
            <Input
              value={newLinkLabel}
              onChange={(e) => setNewLinkLabel(e.target.value)}
              placeholder="Label"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 sm:flex-[2]">
            <Input
              value={newLinkUrl}
              onChange={(e) => setNewLinkUrl(e.target.value)}
              placeholder="URL"
              className="h-8 text-xs"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddLink();
                }
              }}
            />
          </div>
          <div className="flex items-end gap-2">
            <Select
              value={newLinkIcon}
              onValueChange={(v: "external" | "github" | "notepad") =>
                setNewLinkIcon(v)
              }
            >
              <SelectTrigger className="h-8 w-full text-xs sm:w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINK_ICONS.map((li) => (
                  <SelectItem
                    key={li.value}
                    value={li.value}
                    className="text-xs"
                  >
                    <div className="flex items-center gap-1.5">
                      <li.icon className="size-3" />
                      {li.label}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              className="h-8 shrink-0"
              onClick={handleAddLink}
              disabled={!newLinkLabel.trim() || !newLinkUrl.trim()}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Images</Label>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              handleUpload(
                file,
                setUploadingImage,
                (url) => setImages([...images, url]),
                imageInputRef,
              );
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-fit text-xs gap-1.5"
          onClick={() => imageInputRef.current?.click()}
          disabled={uploadingImage}
        >
          {uploadingImage ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          {uploadingImage ? "Uploading..." : "Upload Image"}
        </Button>
        {images.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mt-2">
            {images.map((url, i) => (
              <div
                key={url}
                className="relative group rounded-md overflow-hidden border"
              >
                <img src={url} alt="" className="w-full h-20 object-cover" />
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      void platform.copyText(url);
                      toast.success("URL copied");
                    }}
                    className="p-1.5 rounded-md bg-background/80 hover:bg-background"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setImages(images.filter((_, idx) => idx !== i))
                    }
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
        <Label className="text-xs">Media (for markdown)</Label>
        <input
          ref={mediaInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file)
              handleUpload(
                file,
                setUploadingMedia,
                (url) => setMedia([...media, url]),
                mediaInputRef,
              );
          }}
        />
        <Button
          variant="outline"
          size="sm"
          className="h-8 w-fit text-xs gap-1.5"
          onClick={() => mediaInputRef.current?.click()}
          disabled={uploadingMedia}
        >
          {uploadingMedia ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <ImagePlus className="size-3.5" />
          )}
          {uploadingMedia ? "Uploading..." : "Upload Media"}
        </Button>
        {media.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            {media.map((url) => (
              <div
                key={url}
                className="relative group rounded-md overflow-hidden border"
              >
                <img src={url} alt="" className="w-full h-24 object-cover" />
                <div className="absolute inset-0 bg-black/50  flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      void platform.copyText(url);
                      toast.success("URL copied");
                    }}
                    className="p-1.5 rounded-md bg-background/80 hover:bg-background"
                  >
                    <Copy className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMedia(media.filter((m) => m !== url))}
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
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder="Write project details in markdown..."
              rows={16}
              className="font-mono text-sm"
            />
          </TabsContent>
          <TabsContent value="preview">
            {markdown.trim() ? (
              <div className="rounded-md border p-4 min-h-[250px] overflow-y-auto">
                <MarkdownRenderer content={markdown} />
              </div>
            ) : (
              <div className="rounded-md border p-4 min-h-[250px] flex items-center justify-center text-muted-foreground text-sm">
                Nothing to preview
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Separator />

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Checkbox
            id="project-active"
            checked={isActive}
            onCheckedChange={(checked) => setIsActive(checked === true)}
          />
          <Label htmlFor="project-active" className="text-xs cursor-pointer">
            Published
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="project-featured"
            checked={isFeatured}
            onCheckedChange={(checked) => setIsFeatured(checked === true)}
          />
          <Label htmlFor="project-featured" className="text-xs cursor-pointer">
            Featured on homepage
          </Label>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {saving && <Loader2 className="size-3.5 animate-spin" />}
          {mode === "create" ? "Create Project" : "Save Changes"}
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
