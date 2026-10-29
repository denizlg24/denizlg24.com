"use client";

import type { ITimelineItem } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { Properties, Property } from "@repo/ui/properties";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Spinner } from "@repo/ui/spinner";
import { Switch } from "@repo/ui/switch";
import {
  CalendarArrowDown,
  CalendarArrowUp,
  Eye,
  ImageIcon,
  Shapes,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { ImageCropDialog } from "../media/image-crop-dialog";
import {
  DocumentEditorShell,
  type EditableLink,
  LeadField,
  LinksSection,
  TitleField,
  uploadImage,
} from "../projects/document-editor";
import { useAdmin } from "../provider";
import { parseTimelineDate } from "./timeline-dates";

type Category = ITimelineItem["category"];

const CATEGORIES: { value: Category; label: string }[] = [
  { value: "work", label: "Work" },
  { value: "education", label: "Education" },
  { value: "personal", label: "Personal" },
];

interface TimelineFormProps {
  mode: "create" | "edit";
  item?: ITimelineItem;
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  onSuccess: (item: ITimelineItem) => void;
  onDeleted?: () => void;
}

export function TimelineForm({
  mode,
  item,
  icon,
  backTo,
  backLabel,
  onSuccess,
  onDeleted,
}: TimelineFormProps) {
  const { client } = useAdmin();
  const [title, setTitle] = useState(item?.title ?? "");
  const [subtitle, setSubtitle] = useState(item?.subtitle ?? "");
  const [logoUrl, setLogoUrl] = useState(item?.logoUrl ?? "");
  const [dateFrom, setDateFrom] = useState(item?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(item?.dateTo ?? "");
  const [category, setCategory] = useState<Category>(item?.category ?? "work");
  const [topics, setTopics] = useState<string[]>(item?.topics ?? []);
  const [links, setLinks] = useState<EditableLink[]>(
    item?.links?.map((l) => ({ label: l.label, url: l.url, icon: l.icon })) ??
      [],
  );
  const [isActive, setIsActive] = useState(item?.isActive ?? true);
  const [saving, setSaving] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [pendingLogo, setPendingLogo] = useState<{
    file: File;
    src: string;
  } | null>(null);

  const logoInputRef = useRef<HTMLInputElement>(null);

  const clearPendingLogo = () => {
    setPendingLogo((prev) => {
      if (prev) URL.revokeObjectURL(prev.src);
      return null;
    });
  };

  const handleLogoPick = (file: File | undefined) => {
    if (logoInputRef.current) logoInputRef.current.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files allowed");
      return;
    }
    setPendingLogo({ file, src: URL.createObjectURL(file) });
  };

  const uploadLogo = async (file: File) => {
    setUploadingLogo(true);
    const url = await uploadImage(client, file);
    setUploadingLogo(false);
    if (url) setLogoUrl(url);
  };

  const fromInvalid = dateFrom.trim() !== "" && !parseTimelineDate(dateFrom);
  const toInvalid = dateTo.trim() !== "" && !parseTimelineDate(dateTo);

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error("Title required");
      return;
    }
    if (!subtitle.trim()) {
      toast.error("Subtitle required");
      return;
    }
    if (!dateFrom.trim()) {
      toast.error("Start date required");
      return;
    }

    setSaving(true);
    const body = {
      title: title.trim(),
      subtitle: subtitle.trim(),
      // send empty strings (not undefined) so clearing a field persists on edit
      logoUrl: logoUrl.trim(),
      dateFrom: dateFrom.trim(),
      dateTo: dateTo.trim(),
      category,
      topics,
      links,
      isActive,
    };

    try {
      if (mode === "create") {
        const result = await client.post<{ item: ITimelineItem }>(
          "timeline",
          body,
        );
        toast.success("Entry created");
        onSuccess(result.item);
      } else if (item) {
        const result = await client.patch<{ item: ITimelineItem }>(
          `timeline/${item._id}`,
          body,
        );
        toast.success("Entry updated");
        onSuccess(result.item);
      }
    } catch {
      toast.error(
        mode === "create" ? "Failed to create entry" : "Failed to update entry",
      );
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!item) return;
    try {
      await client.del<{ success: boolean }>(`timeline/${item._id}`);
      toast.success("Entry deleted");
      onDeleted?.();
    } catch {
      toast.error("Failed to delete entry");
    }
  };

  const canSubmit =
    title.trim().length > 0 &&
    subtitle.trim().length > 0 &&
    dateFrom.trim().length > 0 &&
    !saving;

  return (
    <DocumentEditorShell
      icon={icon}
      backTo={backTo}
      backLabel={backLabel}
      title={mode === "edit" ? item?.title || "Untitled" : "New entry"}
      actions={
        <>
          {mode === "edit" && item ? (
            <ConfirmButton
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Delete entry"
                >
                  <Trash2 />
                </Button>
              }
              title="Delete entry?"
              description={`“${item.title}” will be permanently deleted.`}
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
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <TitleField value={title} onChange={setTitle} placeholder="Role" />
          <LeadField
            value={subtitle}
            onChange={setSubtitle}
            placeholder="Company or institution"
            label="Subtitle"
          />
        </div>
        {logoUrl ? (
          <img
            src={logoUrl}
            alt=""
            className="size-14 shrink-0 rounded-md object-cover"
          />
        ) : null}
      </div>

      <Properties>
        <Property icon={<Shapes />} label="Category">
          <Select
            value={category}
            onValueChange={(value: Category) => setCategory(value)}
          >
            <SelectTrigger size="sm" aria-label="Category">
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
        </Property>
        <Property icon={<Eye />} label="Published">
          <Switch
            checked={isActive}
            onCheckedChange={setIsActive}
            aria-label="Published"
          />
        </Property>
        <Property icon={<CalendarArrowUp />} label="From">
          <Input
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
            placeholder="MM-DD-YYYY"
            aria-label="From"
            aria-invalid={fromInvalid || undefined}
            className="h-7 w-40 tabular-nums"
          />
        </Property>
        <Property icon={<CalendarArrowDown />} label="To">
          <Input
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
            placeholder="Present"
            aria-label="To"
            aria-invalid={toInvalid || undefined}
            className="h-7 w-40 tabular-nums"
          />
        </Property>
        <Property icon={<ImageIcon />} label="Logo">
          <div className="flex items-center gap-1">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => handleLogoPick(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => logoInputRef.current?.click()}
              disabled={uploadingLogo}
            >
              {uploadingLogo ? <Spinner className="size-3.5" /> : null}
              {logoUrl ? "Replace" : "Upload"}
            </Button>
            {logoUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Remove logo"
                className="text-muted-foreground"
                onClick={() => setLogoUrl("")}
              >
                <X />
              </Button>
            ) : null}
          </div>
        </Property>
      </Properties>

      <TopicsSection topics={topics} onChange={setTopics} />

      <LinksSection links={links} onChange={setLinks} />

      {pendingLogo ? (
        <ImageCropDialog
          src={pendingLogo.src}
          open
          onOpenChange={(open) => {
            if (!open) clearPendingLogo();
          }}
          onCropped={(blob) => {
            const file = new File([blob], "logo.png", { type: "image/png" });
            clearPendingLogo();
            void uploadLogo(file);
          }}
          onUseOriginal={() => {
            const file = pendingLogo.file;
            clearPendingLogo();
            void uploadLogo(file);
          }}
        />
      ) : null}
    </DocumentEditorShell>
  );
}

/** Topics read as bullet points on the public timeline, so each gets a full row. */
function TopicsSection({
  topics,
  onChange,
}: {
  topics: string[];
  onChange: (topics: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const topic = draft.trim();
    if (!topic || topics.includes(topic)) return;
    onChange([...topics, topic]);
    setDraft("");
  };

  return (
    <Section title="Topics" count={topics.length || undefined}>
      {topics.length > 0 ? (
        <ul className="flex flex-col">
          {topics.map((topic) => (
            <li
              key={topic}
              className="group/topic -mx-2 flex min-h-8 items-start gap-3 rounded-md px-2 py-1.5 text-sm hover:bg-surface/70"
            >
              <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
              <span className="min-w-0 flex-1 text-accent-strong">{topic}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="Remove topic"
                className="text-muted-foreground opacity-0 group-hover/topic:opacity-100 focus-visible:opacity-100"
                onClick={() => onChange(topics.filter((t) => t !== topic))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState compact label="No topics" />
      )}
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder="Add topic"
        aria-label="Add topic"
      />
    </Section>
  );
}
