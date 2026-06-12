"use client";

import {
  ExternalLink,
  ImagePlus,
  Loader2,
  NotebookText,
  Plus,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { denizApi } from "@/lib/api-wrapper";
import type { ITimelineItem } from "@/lib/data-types";

const LINK_ICONS = [
  { value: "external" as const, label: "External", icon: ExternalLink },
  { value: "github" as const, label: "GitHub", icon: FaGithub },
  { value: "notepad" as const, label: "Notepad", icon: NotebookText },
];

const CATEGORIES = [
  { value: "work" as const, label: "Work" },
  { value: "education" as const, label: "Education" },
  { value: "personal" as const, label: "Personal" },
];

interface TimelineFormProps {
  mode: "create" | "edit";
  item?: ITimelineItem;
  api: denizApi;
  onSuccess: (item: ITimelineItem) => void;
  onCancel?: () => void;
}

export function TimelineForm({
  mode,
  item,
  api,
  onSuccess,
  onCancel,
}: TimelineFormProps) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? "");
  const [logoUrl, setLogoUrl] = useState(item?.logoUrl ?? "");
  const [dateFrom, setDateFrom] = useState(item?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(item?.dateTo ?? "");
  const [category, setCategory] = useState<"work" | "education" | "personal">(
    item?.category ?? "work",
  );
  const [topics, setTopics] = useState<string[]>(item?.topics ?? []);
  const [links, setLinks] = useState<
    { label: string; url: string; icon: "external" | "github" | "notepad" }[]
  >(
    item?.links?.map((l) => ({ label: l.label, url: l.url, icon: l.icon })) ??
      [],
  );
  const [isActive, setIsActive] = useState(item?.isActive ?? true);

  const [topicInput, setTopicInput] = useState("");
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [newLinkIcon, setNewLinkIcon] = useState<
    "external" | "github" | "notepad"
  >("external");
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);

  const handleAddTopic = () => {
    const topic = topicInput.trim();
    if (!topic || topics.includes(topic)) return;
    setTopics([...topics, topic]);
    setTopicInput("");
  };

  const handleTopicKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddTopic();
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
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

    setUploadingLogo(true);
    const formData = new FormData();
    formData.append("file", file);

    const result = await api.UPLOAD<{ url: string; hash: string }>({
      endpoint: "upload",
      formData,
    });

    if ("code" in result) {
      toast.error("Upload failed");
    } else {
      setLogoUrl(result.url);
      toast.success("Logo uploaded");
    }
    setUploadingLogo(false);
    if (logoInputRef.current) logoInputRef.current.value = "";
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
    if (!dateFrom) {
      toast.error("Start date required");
      return;
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      logoUrl: logoUrl || undefined,
      dateFrom,
      dateTo: dateTo || undefined,
      category,
      topics,
      links,
      isActive,
    };

    if (mode === "create") {
      const result = await api.POST<{
        message: string;
        timelineItem: ITimelineItem;
      }>({
        endpoint: "timeline",
        body,
      });
      if ("code" in result) {
        toast.error("Failed to create timeline item");
      } else {
        toast.success("Timeline item created");
        onSuccess(result.timelineItem);
      }
    } else if (item) {
      const result = await api.PATCH<{ timelineItem: ITimelineItem }>({
        endpoint: `timeline/${item._id}`,
        body,
      });
      if ("code" in result) {
        toast.error("Failed to update timeline item");
      } else {
        toast.success("Timeline item updated");
        onSuccess(result.timelineItem);
      }
    }
    setSaving(false);
  };

  const canSubmit = title.trim() && subtitle.trim() && dateFrom && !saving;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Title</Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Position or role title"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Subtitle</Label>
          <Input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Company or institution"
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Logo</Label>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleLogoUpload}
        />
        <div className="flex items-center gap-3">
          {logoUrl ? (
            <div className="relative group">
              <img
                src={logoUrl}
                alt=""
                className="size-12 rounded-md object-cover border"
              />
              <button
                type="button"
                onClick={() => setLogoUrl("")}
                className="absolute -top-1.5 -right-1.5 p-0.5 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="size-3" />
              </button>
            </div>
          ) : null}
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={() => logoInputRef.current?.click()}
            disabled={uploadingLogo}
          >
            {uploadingLogo ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
            {uploadingLogo
              ? "Uploading..."
              : logoUrl
                ? "Change Logo"
                : "Upload Logo"}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">From</Label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">To (leave empty for current)</Label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Category</Label>
        <Select
          value={category}
          onValueChange={(v: "work" | "education" | "personal") =>
            setCategory(v)
          }
        >
          <SelectTrigger className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CATEGORIES.map((c) => (
              <SelectItem key={c.value} value={c.value}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      <div className="flex flex-col gap-1.5">
        <Label className="text-xs">Topics</Label>
        <div className="flex items-center gap-2">
          <Input
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            onKeyDown={handleTopicKeyDown}
            placeholder="Add topic..."
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 shrink-0"
            onClick={handleAddTopic}
            disabled={!topicInput.trim()}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
        {topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-1">
            {topics.map((topic) => (
              <Badge
                key={topic}
                variant="secondary"
                className="text-xs gap-1 pr-1"
              >
                {topic}
                <button
                  type="button"
                  onClick={() => setTopics(topics.filter((t) => t !== topic))}
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
        <div className="flex items-end gap-2 mt-1">
          <div className="flex flex-col gap-1 flex-1">
            <Input
              value={newLinkLabel}
              onChange={(e) => setNewLinkLabel(e.target.value)}
              placeholder="Label"
              className="h-8 text-xs"
            />
          </div>
          <div className="flex flex-col gap-1 flex-[2]">
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
          <Select
            value={newLinkIcon}
            onValueChange={(v: "external" | "github" | "notepad") =>
              setNewLinkIcon(v)
            }
          >
            <SelectTrigger className="h-8 w-28 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LINK_ICONS.map((li) => (
                <SelectItem key={li.value} value={li.value} className="text-xs">
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

      <Separator />

      <div className="flex items-center gap-2">
        <Checkbox
          id="timeline-active"
          checked={isActive}
          onCheckedChange={(checked) => setIsActive(checked === true)}
        />
        <Label htmlFor="timeline-active" className="text-xs cursor-pointer">
          Published
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
          {mode === "create" ? "Create Item" : "Save Changes"}
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
