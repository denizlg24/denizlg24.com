"use client";

import { Button } from "@repo/ui/button";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { MarkdownRenderer } from "@repo/ui/markdown-renderer";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { Section } from "@repo/ui/section";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Skeleton } from "@repo/ui/skeleton";
import { Spinner } from "@repo/ui/spinner";
import { FilterTabs } from "@repo/ui/toolbar";
import { cn } from "@repo/ui/utils";
import { Copy, ExternalLink, ImagePlus, NotebookText, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ComponentType, type ReactNode, useRef, useState } from "react";
import { FaGithub } from "react-icons/fa6";
import { toast } from "sonner";
import type { AdminClient } from "../client";
import { useAdmin } from "../provider";

/*
 * The document layout shared by the blog, project and timeline editors: a
 * header with a crumb back to the list and the save action, then a narrow
 * column holding a large title, the record's properties and its content.
 */

export function DocumentEditorShell({
  icon,
  backTo,
  backLabel,
  title,
  actions,
  children,
}: {
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  title: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const { slots } = useAdmin();
  const router = useRouter();
  return (
    <Page>
      <PageHeader
        leading={slots?.sidebarTrigger}
        crumbs={[{ label: backLabel, onClick: () => router.push(backTo) }]}
        icon={icon}
        title={title}
      >
        {actions}
      </PageHeader>
      <PageBody width="narrow">{children}</PageBody>
    </Page>
  );
}

export function DocumentEditorSkeleton({
  icon,
  backTo,
  backLabel,
  title,
  properties = 4,
}: {
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  title: string;
  properties?: number;
}) {
  return (
    <DocumentEditorShell
      icon={icon}
      backTo={backTo}
      backLabel={backLabel}
      title={title}
    >
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: properties }).map((_, index) => (
          <div
            key={index}
            className="grid h-8 grid-cols-[minmax(7rem,10rem)_1fr] items-center gap-3"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-4 w-2/5" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-48 w-full" />
      </div>
    </DocumentEditorShell>
  );
}

export function DocumentNotFound({
  icon,
  backTo,
  backLabel,
  label,
}: {
  icon: ReactNode;
  backTo: string;
  backLabel: string;
  label: string;
}) {
  return (
    <DocumentEditorShell
      icon={icon}
      backTo={backTo}
      backLabel={backLabel}
      title="Not found"
    >
      <EmptyState icon={icon} label={label} />
    </DocumentEditorShell>
  );
}

/** The document's title: a large borderless input. */
export function TitleField({
  value,
  onChange,
  placeholder = "Untitled",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label="Title"
      className="w-full min-w-0 bg-transparent text-3xl font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/50"
    />
  );
}

/** The line under the title — an excerpt or subtitle — growing with its text. */
export function LeadField({
  value,
  onChange,
  placeholder,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      aria-label={label}
      rows={1}
      className="field-sizing-content w-full min-w-0 resize-none bg-transparent text-base leading-relaxed text-muted-foreground outline-none placeholder:text-muted-foreground/50"
    />
  );
}

/** One removable value in a property. */
export function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-md bg-surface pr-1 pl-2 text-xs text-accent-strong dark:bg-muted">
      <span className="truncate">{label}</span>
      <button
        type="button"
        aria-label={`Remove ${label}`}
        onClick={onRemove}
        className="rounded-sm p-0.5 text-muted-foreground hover:text-accent-strong"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Removable chips with an inline input; Enter or comma adds, Backspace on empty removes the last. */
export function ChipInput({
  values,
  onChange,
  placeholder = "Add…",
  normalize = (value) => value.trim(),
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  normalize?: (value: string) => string;
}) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const next = normalize(draft);
    if (!next) return;
    if (!values.includes(next)) onChange([...values, next]);
    setDraft("");
  };

  return (
    <div className="flex min-h-8 flex-wrap items-center gap-1 py-1">
      {values.map((value) => (
        <Chip
          key={value}
          label={value}
          onRemove={() => onChange(values.filter((item) => item !== value))}
        />
      ))}
      <input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          } else if (event.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder={values.length ? "" : placeholder}
        className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
      />
    </div>
  );
}

export type LinkIcon = "external" | "github" | "notepad";
export interface EditableLink {
  label: string;
  url: string;
  icon: LinkIcon;
}

const LINK_ICONS: {
  value: LinkIcon;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: "external", label: "External", icon: ExternalLink },
  { value: "github", label: "GitHub", icon: FaGithub },
  { value: "notepad", label: "Notepad", icon: NotebookText },
];

function linkIcon(icon: LinkIcon) {
  return LINK_ICONS.find((entry) => entry.value === icon)?.icon ?? ExternalLink;
}

/** A section of links: one row per link, plus an inline row to add another. */
export function LinksSection({
  links,
  onChange,
}: {
  links: EditableLink[];
  onChange: (links: EditableLink[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [icon, setIcon] = useState<LinkIcon>("external");

  const canAdd = label.trim().length > 0 && url.trim().length > 0;
  const add = () => {
    if (!canAdd) return;
    onChange([...links, { label: label.trim(), url: url.trim(), icon }]);
    setLabel("");
    setUrl("");
    setIcon("external");
  };

  return (
    <Section title="Links" count={links.length || undefined}>
      {links.length > 0 ? (
        <div className="flex flex-col">
          {links.map((link, index) => {
            const Icon = linkIcon(link.icon);
            return (
              <div
                key={index}
                className="group/link -mx-2 flex h-8 items-center gap-3 rounded-md px-2 text-sm hover:bg-surface/70"
              >
                <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="shrink-0 text-accent-strong">
                  {link.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {link.url}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${link.label}`}
                  className="text-muted-foreground opacity-0 group-hover/link:opacity-100 focus-visible:opacity-100"
                  onClick={() =>
                    onChange(links.filter((_, position) => position !== index))
                  }
                >
                  <X />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_7rem_auto]">
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Label"
          aria-label="Link label"
        />
        <Input
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://"
          aria-label="Link URL"
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
        />
        <Select
          value={icon}
          onValueChange={(value: LinkIcon) => setIcon(value)}
        >
          <SelectTrigger className="w-full" aria-label="Link icon">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LINK_ICONS.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                <entry.icon className="size-3.5" />
                {entry.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={!canAdd}
        >
          Add
        </Button>
      </div>
    </Section>
  );
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Validates and uploads one image; null when refused or failed (already toasted). */
export async function uploadImage(
  client: AdminClient,
  file: File,
): Promise<string | null> {
  if (!file.type.startsWith("image/")) {
    toast.error("Only image files allowed");
    return null;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast.error("Image must be under 5MB");
    return null;
  }
  const formData = new FormData();
  formData.append("file", file);
  try {
    const result = await client.upload<{ url: string; hash: string }>(
      "upload",
      formData,
    );
    return result.url;
  } catch {
    toast.error("Upload failed");
    return null;
  }
}

/** A section of uploaded images with copy-URL and remove on hover. */
export function ImagesSection({
  title,
  urls,
  onChange,
  columns = 3,
}: {
  title: string;
  urls: string[];
  onChange: (urls: string[]) => void;
  columns?: 2 | 3;
}) {
  const { client, platform } = useAdmin();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handlePick = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setUploading(true);
    const url = await uploadImage(client, file);
    setUploading(false);
    if (url) onChange([...urls, url]);
  };

  return (
    <Section
      title={title}
      count={urls.length || undefined}
      actions={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Spinner className="size-3.5" /> : <ImagePlus />}
          Upload
        </Button>
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void handlePick(event.target.files?.[0])}
      />
      {urls.length > 0 ? (
        <div
          className={cn(
            "grid grid-cols-2 gap-2",
            columns === 3 && "sm:grid-cols-3",
          )}
        >
          {urls.map((url, index) => (
            <div
              key={url}
              className="group/image relative overflow-hidden rounded-md bg-surface"
            >
              <img
                src={url}
                alt=""
                className="aspect-[4/3] w-full object-cover"
              />
              <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 transition-opacity group-hover/image:opacity-100 group-focus-within/image:opacity-100">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  aria-label="Copy URL"
                  onClick={() => {
                    void platform.copyText(url);
                    toast.success("URL copied");
                  }}
                >
                  <Copy />
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-xs"
                  aria-label="Remove image"
                  onClick={() =>
                    onChange(urls.filter((_, position) => position !== index))
                  }
                >
                  <X />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState compact icon={<ImagePlus />} label="No images" />
      )}
    </Section>
  );
}

type MarkdownMode = "write" | "preview";

/** The document body: markdown written in place, with a preview toggle. */
export function MarkdownSection({
  title = "Content",
  value,
  onChange,
  placeholder = "Markdown",
}: {
  title?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [mode, setMode] = useState<MarkdownMode>("write");
  return (
    <Section
      title={title}
      actions={
        <FilterTabs<MarkdownMode>
          value={mode}
          onChange={setMode}
          options={[
            { value: "write", label: "Write" },
            { value: "preview", label: "Preview" },
          ]}
        />
      }
    >
      {mode === "write" ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          aria-label={title}
          className="field-sizing-content min-h-80 w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-accent-strong outline-none placeholder:text-muted-foreground/50"
        />
      ) : value.trim() ? (
        <div className="min-h-80">
          <MarkdownRenderer content={value} />
        </div>
      ) : (
        <EmptyState compact label="Empty" className="min-h-80" />
      )}
    </Section>
  );
}

/** Relative for the last week, absolute after. */
export function formatRelativeDate(dateStr: string): string {
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
