"use client";

import {
  type SurfaceMount,
  type SurfacePatch,
  type SurfaceRevision,
  surfaceAssetNameSchema,
  surfaceInputSchema,
  type WorkspaceSurface,
} from "@repo/schemas";
import { Badge } from "@repo/ui/badge";
import { Button } from "@repo/ui/button";
import { ConfirmButton } from "@repo/ui/confirm-button";
import { CopyButton } from "@repo/ui/copy-button";
import { Dialog, DialogContent, DialogTitle } from "@repo/ui/dialog";
import { EmptyState } from "@repo/ui/empty-state";
import { Input } from "@repo/ui/input";
import { SectionLabel } from "@repo/ui/section";
import { SegmentedControl } from "@repo/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/select";
import { Textarea } from "@repo/ui/textarea";
import { cn } from "@repo/ui/utils";
import { formatDistanceToNowStrict } from "date-fns";
import {
  ArrowUpRight,
  LayoutTemplate,
  RotateCcw,
  RotateCw,
  Trash2,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { z } from "zod";
import { useAdmin } from "../../provider";
import { AppIcon, IconPicker } from "../page-icon";
import { useWorkspaceNav } from "../use-workspace-nav";
import type { SurfaceErrorEntry } from "./document";
import { SurfaceConflictError, useSurfaceList, useSurfaceStore } from "./store";
import { SurfaceFrame } from "./surface-frame";

type Draft = z.output<typeof surfaceInputSchema>;
type CodeField = "html" | "css" | "js" | "head";
type Tab = CodeField | "assets" | "history" | "errors";

const CODE_TABS: { value: CodeField; label: string }[] = [
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "js", label: "JS" },
  { value: "head", label: "Head" },
];

const DRAFT_FIELDS = [
  "name",
  "description",
  "icon",
  "head",
  "html",
  "css",
  "js",
  "chrome",
  "mount",
] as const satisfies readonly (keyof Draft & keyof SurfacePatch)[];

const LABEL =
  "text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground";

/** Modules a surface may replace. Settings stays out: it hosts this editor. */
const UNMOUNTABLE = new Set(["settings"]);

function toDraft(surface: WorkspaceSurface | null): Draft {
  return surfaceInputSchema.parse(surface ?? { name: "Untitled surface" });
}

function mountValue(mount: SurfaceMount): string {
  return mount.kind === "module" ? `module:${mount.module}` : mount.kind;
}

function parseMount(value: string): SurfaceMount {
  if (value === "home") return { kind: "home" };
  if (value.startsWith("module:")) {
    return { kind: "module", module: value.slice("module:".length) };
  }
  return { kind: "none" };
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withCode(draft: Draft, field: CodeField, value: string): Draft {
  switch (field) {
    case "html":
      return { ...draft, html: value };
    case "css":
      return { ...draft, css: value };
    case "js":
      return { ...draft, js: value };
    case "head":
      return { ...draft, head: value };
  }
}

type DraftField = (typeof DRAFT_FIELDS)[number];

function assignField<K extends DraftField>(
  target: Draft,
  source: Draft,
  key: K,
) {
  target[key] = source[key];
}

function changedFields(draft: Draft, saved: Draft): SurfacePatch {
  const patch: SurfacePatch = {};
  for (const field of DRAFT_FIELDS) {
    if (!sameValue(draft[field], saved[field])) {
      Object.assign(patch, { [field]: draft[field] });
    }
  }
  return patch;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function assetNameFor(fileName: string): string {
  const cleaned = fileName
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[^A-Za-z0-9]+/, "")
    .slice(0, 64);
  return cleaned || "asset";
}

function ago(iso: string): string {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

function MountPicker({
  value,
  selfId,
  onChange,
}: {
  value: SurfaceMount;
  selfId: string | null;
  onChange: (mount: SurfaceMount) => void;
}) {
  const { sidebarModules } = useWorkspaceNav();
  const list = useSurfaceList();
  const holder = (mount: SurfaceMount) =>
    list?.find(
      (s) =>
        s.id !== selfId && sameValue(s.mount, mount) && s.mount.kind !== "none",
    )?.name;
  const option = (mount: SurfaceMount, label: string) => {
    const held = holder(mount);
    return (
      <SelectItem key={mountValue(mount)} value={mountValue(mount)}>
        {label}
        {held ? (
          <span className="ml-1.5 text-muted-foreground">· {held}</span>
        ) : null}
      </SelectItem>
    );
  };

  return (
    <Select
      value={mountValue(value)}
      onValueChange={(next) => onChange(parseMount(next))}
    >
      <SelectTrigger aria-label="Mount" className="h-7 w-44 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {option({ kind: "none" }, "Not mounted")}
        {option({ kind: "home" }, "Home")}
        {sidebarModules
          .filter((module) => !UNMOUNTABLE.has(module.id))
          .map((module) =>
            option({ kind: "module", module: module.id }, module.label),
          )}
      </SelectContent>
    </Select>
  );
}

function AssetsPane({ surface }: { surface: WorkspaceSurface | null }) {
  const { client } = useAdmin();
  const addAsset = useSurfaceStore((s) => s.addAsset);
  const removeAsset = useSurfaceStore((s) => s.removeAsset);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  if (!surface) {
    return <EmptyState compact icon={<Upload />} label="Save first" />;
  }

  const upload = async (file: File) => {
    const assetName = name.trim() || assetNameFor(file.name);
    const parsed = surfaceAssetNameSchema.safeParse(assetName);
    if (!parsed.success) {
      toast.error("Invalid asset name");
      return;
    }
    setBusy(true);
    try {
      await addAsset(client, surface.id, file, parsed.data);
      setName("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Name"
          aria-label="Asset name"
          className="h-8 max-w-56 font-mono text-xs"
        />
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload /> Upload
        </Button>
        <input
          ref={input}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {surface.assets.length}
        </span>
      </div>
      {surface.assets.length === 0 ? (
        <span className="text-sm text-muted-foreground">—</span>
      ) : (
        <div role="list" className="flex flex-col divide-y divide-border/70">
          {surface.assets.map((asset) => {
            const token = `{{asset:${asset.name}}}`;
            return (
              <div
                key={asset.name}
                role="listitem"
                className="flex items-center gap-3 py-1.5"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-xs text-accent-strong">
                    {token}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">
                    {asset.contentType} · {formatBytes(asset.size)}
                  </span>
                </span>
                <CopyButton value={token} label={`Copy ${token}`} />
                <ConfirmButton
                  title={`Delete ${asset.name}?`}
                  actionLabel="Delete"
                  destructive
                  trigger={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${asset.name}`}
                      className="text-muted-foreground"
                    >
                      <Trash2 />
                    </Button>
                  }
                  onConfirm={async () => {
                    try {
                      await removeAsset(client, surface.id, asset.name);
                    } catch (error) {
                      toast.error(
                        error instanceof Error
                          ? error.message
                          : "Delete failed",
                      );
                    }
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function HistoryPane({
  surface,
  onReverted,
}: {
  surface: WorkspaceSurface | null;
  onReverted: (surface: WorkspaceSurface) => void;
}) {
  const { client } = useAdmin();
  const history = useSurfaceStore((s) => s.history);
  const revert = useSurfaceStore((s) => s.revert);
  const [revisions, setRevisions] = useState<SurfaceRevision[] | null>(null);
  const [failed, setFailed] = useState(false);
  const id = surface?.id ?? null;
  const rev = surface?.rev ?? 0;

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setFailed(false);
    history(client, id)
      .then((next) => {
        if (!cancelled) setRevisions(next);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [client, id, rev, history]);

  if (!surface) return <span className="text-sm text-muted-foreground">—</span>;
  if (failed) {
    return (
      <span className="text-sm text-destructive">History unavailable</span>
    );
  }
  if (!revisions) {
    return <span className="text-sm text-muted-foreground">…</span>;
  }

  return (
    <div role="list" className="flex flex-col divide-y divide-border/70">
      {revisions.map((revision) => (
        <div
          key={revision.rev}
          role="listitem"
          className="flex items-center gap-3 py-1.5"
        >
          <span className="w-10 shrink-0 font-mono text-xs tabular-nums text-accent-strong">
            r{revision.rev}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs">
              {revision.changed.length ? revision.changed.join(", ") : "—"}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {revision.actor} · {ago(revision.at)}
            </span>
          </span>
          {revision.rev === surface.rev ? (
            <span className="text-[11px] text-muted-foreground">current</span>
          ) : (
            <ConfirmButton
              title={`Revert to r${revision.rev}?`}
              actionLabel="Revert"
              trigger={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Revert to r${revision.rev}`}
                  className="text-muted-foreground"
                >
                  <RotateCcw />
                </Button>
              }
              onConfirm={async () => {
                try {
                  onReverted(await revert(client, surface.id, revision.rev));
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Revert failed",
                  );
                }
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function ErrorRows({
  errors,
}: {
  errors: { message: string; source?: string; at?: string }[];
}) {
  if (errors.length === 0) {
    return <span className="text-sm text-muted-foreground">—</span>;
  }
  return (
    <div role="list" className="flex flex-col divide-y divide-border/70">
      {errors.map((error, index) => (
        <div
          key={index}
          role="listitem"
          className="flex flex-col gap-0.5 py-1.5"
        >
          <span className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
            {error.message}
          </span>
          {error.source || error.at ? (
            <span className="truncate text-[11px] text-muted-foreground">
              {[error.source, error.at ? ago(error.at) : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function ErrorsPane({
  surface,
  preview,
  onClearPreview,
}: {
  surface: WorkspaceSurface | null;
  preview: SurfaceErrorEntry[];
  onClearPreview: () => void;
}) {
  const { client } = useAdmin();
  const clearErrors = useSurfaceStore((s) => s.clearErrors);
  const saved = surface?.errors ?? [];

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <SectionLabel
          count={saved.length}
          actions={
            surface && saved.length > 0 ? (
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  void clearErrors(client, surface.id).catch((error: unknown) =>
                    toast.error(
                      error instanceof Error ? error.message : "Clear failed",
                    ),
                  )
                }
              >
                Clear
              </Button>
            ) : null
          }
        >
          Reported
        </SectionLabel>
        <ErrorRows errors={saved} />
      </section>
      <section className="flex flex-col gap-2">
        <SectionLabel
          count={preview.length}
          actions={
            preview.length > 0 ? (
              <Button variant="ghost" size="xs" onClick={onClearPreview}>
                Clear
              </Button>
            ) : null
          }
        >
          Preview
        </SectionLabel>
        <ErrorRows errors={preview} />
      </section>
    </div>
  );
}

/**
 * Edits a surface: identity, mount and chrome, its four code fields, assets,
 * history and errors, beside a live preview. Saving keeps the editor open.
 */
export function SurfaceEditor({
  open,
  onOpenChange,
  surface,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null makes a new one. */
  surface: WorkspaceSurface | null;
  onCreated: (surface: WorkspaceSurface) => void;
}) {
  const { client, routes } = useAdmin();
  const router = useRouter();
  const create = useSurfaceStore((s) => s.create);
  const update = useSurfaceStore((s) => s.update);
  const remove = useSurfaceStore((s) => s.remove);
  const setBypass = useSurfaceStore((s) => s.setBypass);
  const [draft, setDraft] = useState<Draft>(() => toDraft(surface));
  /** The saved copy the draft is edited against, and its rev. */
  const [base, setBase] = useState<{ rev: number; draft: Draft } | null>(() =>
    surface ? { rev: surface.rev, draft: toDraft(surface) } : null,
  );
  /** Fields both the owner and an upstream edit changed, to different values. */
  const [conflict, setConflict] = useState<DraftField[]>([]);
  const [tab, setTab] = useState<Tab>("html");
  const [saving, setSaving] = useState(false);
  const [previewErrors, setPreviewErrors] = useState<SurfaceErrorEntry[]>([]);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewDraft, setPreviewDraft] = useState<Draft>(draft);

  /** `id:rev` of the last reseed, so the rebase below skips the copy it just took. */
  const seededAt = useRef<string | null>(null);
  const reseed = (next: WorkspaceSurface | null) => {
    seededAt.current = next ? `${next.id}:${next.rev}` : null;
    const seeded = toDraft(next);
    setDraft(seeded);
    setBase(next ? { rev: next.rev, draft: seeded } : null);
    setConflict([]);
    setPreviewDraft(seeded);
    setPreviewErrors([]);
    setPreviewKey((k) => k + 1);
  };

  const latest = useRef(surface);
  latest.current = surface;
  const seedKey = open ? (surface?.id ?? "new") : null;
  // Re-seed on open or on another surface only: a refetch replaces the stored
  // object and must not wipe an edit in progress.
  useEffect(() => {
    if (seedKey === null) return;
    reseed(latest.current);
  }, [seedKey]);

  // A newer rev arrived while open — an agent's edit, a 409, or our own save.
  // Untouched fields follow it; a field both sides changed differently is held
  // as a conflict until the owner keeps theirs or takes the upstream value.
  const upstreamRev = surface?.rev ?? null;
  useEffect(() => {
    const current = latest.current;
    if (!open || !current || !base || current.rev === base.rev) return;
    if (seededAt.current === `${current.id}:${current.rev}`) return;
    if (seededAt.current?.split(":")[0] !== current.id) return;
    const upstream = toDraft(current);
    const next: Draft = { ...draft };
    const clashes: DraftField[] = [];
    for (const field of DRAFT_FIELDS) {
      const mine = !sameValue(draft[field], base.draft[field]);
      if (!mine) {
        assignField(next, upstream, field);
      } else if (
        !sameValue(upstream[field], base.draft[field]) &&
        !sameValue(draft[field], upstream[field])
      ) {
        clashes.push(field);
      }
    }
    setDraft(next);
    setBase({ rev: current.rev, draft: upstream });
    if (clashes.length > 0) {
      setConflict((held) => [...new Set([...held, ...clashes])]);
    }
  }, [upstreamRev]);

  const patch = (next: Partial<Draft>) => setDraft((d) => ({ ...d, ...next }));
  const valid = surfaceInputSchema.safeParse(draft);
  const dirty = base
    ? Object.keys(changedFields(draft, base.draft)).length > 0
    : true;

  const reloadPreview = () => {
    setPreviewDraft(draft);
    setPreviewErrors([]);
    setPreviewKey((k) => k + 1);
  };

  const takeUpstream = () => {
    if (!base) return;
    const next: Draft = { ...draft };
    for (const field of conflict) assignField(next, base.draft, field);
    setDraft(next);
    setConflict([]);
  };

  const save = async () => {
    if (!valid.success) {
      toast.error(valid.error.issues[0]?.message ?? "Invalid surface");
      return;
    }
    if (conflict.length > 0) return;
    setSaving(true);
    try {
      if (surface && base) {
        const changes = changedFields(valid.data, base.draft);
        if (Object.keys(changes).length > 0) {
          await update(client, surface.id, changes, base.rev);
        }
      } else {
        onCreated(await create(client, valid.data));
      }
      setPreviewDraft(valid.data);
      setPreviewErrors([]);
      setPreviewKey((k) => k + 1);
    } catch (error) {
      if (error instanceof SurfaceConflictError) {
        toast.error(`Changed upstream (r${error.surface.rev})`);
      } else {
        toast.error(error instanceof Error ? error.message : "Save failed");
      }
    } finally {
      setSaving(false);
    }
  };

  const openSurface = () => {
    if (!surface) return;
    setBypass(false);
    onOpenChange(false);
    router.push(routes.surface(surface.id));
  };

  const errorCount = (surface?.errors.length ?? 0) + previewErrors.length;
  const tabs: { value: Tab; label: ReactNode }[] = [
    ...CODE_TABS,
    { value: "assets", label: "Assets" },
    { value: "history", label: "History" },
    {
      value: "errors",
      label: (
        <>
          Errors
          {errorCount > 0 ? (
            <Badge variant="critical" className="ml-1 h-4 px-1 tabular-nums">
              {errorCount}
            </Badge>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={saving ? undefined : onOpenChange}>
      <DialogContent
        size="xl"
        className="flex h-[min(85vh,60rem)] flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
        onKeyDown={(event) => {
          if (!(event.metaKey || event.ctrlKey)) return;
          if (event.key === "s") {
            event.preventDefault();
            if (!saving) void save();
          } else if (event.key === "Enter") {
            event.preventDefault();
            reloadPreview();
          }
        }}
      >
        <fieldset
          disabled={saving}
          className="flex min-w-0 flex-wrap items-center gap-3 border-b px-5 py-3 pr-12 disabled:opacity-70"
        >
          <IconPicker value={draft.icon} onChange={(icon) => patch({ icon })}>
            <button
              type="button"
              aria-label="Icon"
              className="rounded-md p-1 hover:bg-surface"
            >
              <AppIcon value={draft.icon} fallback={LayoutTemplate} />
            </button>
          </IconPicker>
          <DialogTitle className="sr-only">Surface</DialogTitle>
          <input
            value={draft.name}
            onChange={(event) => patch({ name: event.target.value })}
            aria-label="Name"
            className="theme-heading min-w-40 flex-1 bg-transparent text-base font-semibold text-accent-strong outline-none"
          />
          {surface ? (
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              r{surface.rev}
            </span>
          ) : null}
          <MountPicker
            value={draft.mount}
            selfId={surface?.id ?? null}
            onChange={(mount) => patch({ mount })}
          />
          <SegmentedControl
            ariaLabel="Chrome"
            value={draft.chrome}
            className="w-40 [&_button]:min-h-6 [&_button]:text-xs"
            options={[
              { value: "sidebar", label: "Sidebar" },
              { value: "none", label: "Full" },
            ]}
            onValueChange={(chrome) => patch({ chrome })}
          />
          {surface ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open"
              className="text-muted-foreground"
              onClick={openSurface}
            >
              <ArrowUpRight />
            </Button>
          ) : null}
        </fieldset>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-2">
          {/* Disabled while saving: an edit made during the request would be
              lost when the saved copy becomes the new base. */}
          <fieldset
            disabled={saving}
            className="flex min-h-0 min-w-0 flex-col gap-3 border-b px-5 py-4 lg:border-r lg:border-b-0"
          >
            <Input
              value={draft.description}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder="Description"
              aria-label="Description"
              className="h-8 text-xs"
            />
            <div role="tablist" className="flex flex-wrap items-center gap-1">
              {tabs.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.value}
                  onClick={() => setTab(t.value)}
                  className={cn(
                    "inline-flex items-center rounded px-2 py-1 text-xs font-medium",
                    tab === t.value
                      ? "bg-surface text-accent-strong"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
            >
              {tab === "html" ||
              tab === "css" ||
              tab === "js" ||
              tab === "head" ? (
                <Textarea
                  key={tab}
                  aria-label={CODE_TABS.find((t) => t.value === tab)?.label}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={draft[tab]}
                  onChange={(event) =>
                    setDraft((d) => withCode(d, tab, event.target.value))
                  }
                  className="min-h-64 flex-1 resize-none font-mono text-xs leading-relaxed"
                />
              ) : null}
              {tab === "assets" ? <AssetsPane surface={surface} /> : null}
              {tab === "history" ? (
                <HistoryPane surface={surface} onReverted={reseed} />
              ) : null}
              {tab === "errors" ? (
                <ErrorsPane
                  surface={surface}
                  preview={previewErrors}
                  onClearPreview={() => setPreviewErrors([])}
                />
              ) : null}
            </div>
          </fieldset>
          <div className="flex min-h-64 flex-col">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b px-5">
              <span className={LABEL}>Preview</span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Reload preview"
                title="⌘↵"
                className="text-muted-foreground"
                onClick={reloadPreview}
              >
                <RotateCw />
              </Button>
            </div>
            <div className="min-h-0 flex-1">
              <SurfaceFrame
                key={`${surface?.id ?? "new"}:${previewKey}`}
                mode="preview"
                surface={{
                  id: surface?.id ?? "",
                  rev: base?.rev ?? 0,
                  name: previewDraft.name,
                  mount: previewDraft.mount,
                  head: previewDraft.head,
                  html: previewDraft.html,
                  css: previewDraft.css,
                  js: previewDraft.js,
                  assets: surface?.assets ?? [],
                  state: surface?.state ?? {},
                }}
                onErrors={(errors) =>
                  setPreviewErrors((current) =>
                    [...current, ...errors].slice(-50),
                  )
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t px-5 py-3">
          {surface ? (
            <ConfirmButton
              title={`Delete ${surface.name}?`}
              actionLabel="Delete"
              destructive
              trigger={
                <Button variant="ghost" size="sm" className="text-destructive">
                  <Trash2 /> Delete
                </Button>
              }
              onConfirm={async () => {
                try {
                  await remove(client, surface.id);
                  onOpenChange(false);
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Delete failed",
                  );
                }
              }}
            />
          ) : null}
          <span className="flex-1" />
          {conflict.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1 text-xs">
              <span className="truncate text-[color-mix(in_oklab,var(--status-warning)_55%,black)] dark:text-status-warning">
                Changed upstream: {conflict.join(", ")}
              </span>
              <Button
                variant="ghost"
                size="xs"
                disabled={saving}
                onClick={() => setConflict([])}
              >
                Keep mine
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={saving}
                onClick={takeUpstream}
              >
                Take upstream
              </Button>
            </span>
          ) : !valid.success ? (
            <span className="truncate text-xs text-destructive">
              {valid.error.issues[0]?.path.join(".")}:{" "}
              {valid.error.issues[0]?.message}
            </span>
          ) : dirty ? (
            <span className="text-xs text-muted-foreground">Unsaved</span>
          ) : null}
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Close
          </Button>
          <Button
            onClick={() => void save()}
            disabled={saving || !valid.success || !dirty || conflict.length > 0}
          >
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
