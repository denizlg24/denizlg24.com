"use client";

import {
  HOME_PAGE_ID,
  moduleRef,
  SIDEBAR_DEFAULT_WIDTH,
  type WorkspacePage,
} from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Kbd } from "@repo/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@repo/ui/popover";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/sheet";
import { cn } from "@repo/ui/utils";
import {
  ChevronRight,
  ChevronsLeft,
  Eye,
  EyeOff,
  FileText,
  LayoutTemplate,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Star,
  StarOff,
  Trash2,
  Zap,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type ComponentProps,
  type DragEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMobileSidebar } from "./mobile-sidebar";
import { MODULE_SECTIONS } from "./modules";
import { PageMenuItems } from "./page-actions";
import { PageIcon, RefIcon } from "./page-icon";
import { pageTitle } from "./refs";
import { childPages, templatePages, useWorkspaceStore } from "./store";
import { TemplatePicker, useTemplatePicker } from "./template-picker";
import { useActiveLocation, useWorkspaceNav } from "./use-workspace-nav";
import { TriggersDialog } from "./workflows/triggers-dialog";

export const OPEN_COMMAND_PALETTE = "command-palette:open";

const ROW =
  "group/item relative flex h-7 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px] text-foreground transition-colors hover:bg-surface hover:text-accent-strong";
const ROW_ACTIVE = "bg-surface font-medium text-accent-strong";

type DropPosition = "before" | "inside" | "after";

function SidebarRow({
  href,
  active,
  icon,
  label,
  depth = 0,
  leading,
  actions,
  drop,
  ...dragProps
}: {
  href: string;
  active: boolean;
  icon: ReactNode;
  label: ReactNode;
  depth?: number;
  leading?: ReactNode;
  actions?: ReactNode;
  /** Where a dragged row would land relative to this one. */
  drop?: DropPosition | null;
} & Pick<
  HTMLAttributes<HTMLDivElement>,
  | "draggable"
  | "onDragStart"
  | "onDragOver"
  | "onDragLeave"
  | "onDrop"
  | "onDragEnd"
>) {
  return (
    <div
      className={cn(
        ROW,
        active && ROW_ACTIVE,
        drop === "inside" && "bg-accent/30 ring-1 ring-accent",
        drop === "before" &&
          "before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-accent-strong/60",
        drop === "after" &&
          "before:absolute before:inset-x-1 before:-bottom-px before:h-0.5 before:rounded-full before:bg-accent-strong/60",
      )}
      style={{ paddingLeft: `${0.5 + depth * 0.75}rem` }}
      {...dragProps}
    >
      {leading}
      <Link
        href={href}
        className="flex min-w-0 flex-1 items-center gap-2 outline-none after:absolute after:inset-0"
      >
        <span className="flex shrink-0 text-muted-foreground group-hover/item:text-accent-strong">
          {icon}
        </span>
        <span className="truncate">{label}</span>
      </Link>
      {actions ? (
        <span className="relative z-10 flex shrink-0 items-center opacity-0 transition-opacity group-hover/item:opacity-100 has-data-[state=open]:opacity-100">
          {actions}
        </span>
      ) : null}
    </div>
  );
}

// Spreads the rest onto the button: as a `DropdownMenuTrigger asChild` it
// receives the trigger's ref, pointer handlers and data-state, and dropping
// them leaves a menu that never opens.
function RowIconButton({
  label,
  onClick,
  children,
  ...props
}: Omit<ComponentProps<"button">, "onClick"> & {
  label: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick?.(event);
      }}
      className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/60 hover:text-accent-strong data-[state=open]:bg-muted/60"
    >
      {children}
    </button>
  );
}

function SectionHeader({
  label,
  collapsed,
  onToggle,
  actions,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  actions?: ReactNode;
}) {
  return (
    <div className="group/section flex h-7 items-center gap-1 px-2 pt-2">
      <button
        type="button"
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-1 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground transition-colors hover:text-accent-strong"
      >
        <span className="truncate">{label}</span>
        <ChevronRight
          className={cn(
            "size-3 opacity-0 transition group-hover/section:opacity-100",
            !collapsed && "rotate-90",
          )}
        />
      </button>
      {actions ? (
        <span className="flex items-center opacity-0 transition-opacity group-hover/section:opacity-100">
          {actions}
        </span>
      ) : null}
    </div>
  );
}

const DRAG_MIME = "application/x-workspace-page";

function dropPositionFor(event: DragEvent<HTMLDivElement>): DropPosition {
  const rect = event.currentTarget.getBoundingClientRect();
  const y = (event.clientY - rect.top) / rect.height;
  if (y < 0.28) return "before";
  if (y > 0.72) return "after";
  return "inside";
}

function PageTreeRow({
  page,
  depth,
  activePageId,
}: {
  page: WorkspacePage;
  depth: number;
  activePageId: string | null;
}) {
  const router = useRouter();
  const { pageHref } = useWorkspaceNav();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const expanded = useWorkspaceStore((s) =>
    s.workspace.sidebar.expandedPages.includes(page.id),
  );
  const toggleExpanded = useWorkspaceStore((s) => s.toggleExpanded);
  const createPage = useWorkspaceStore((s) => s.createPage);
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const movePage = useWorkspaceStore((s) => s.movePage);
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<DropPosition | null>(null);
  const children = childPages(pages, page.id);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData(DRAG_MIME);
    const position = drop ?? dropPositionFor(event);
    setDrop(null);
    if (!draggedId || draggedId === page.id) return;
    if (position === "inside") {
      movePage(
        draggedId,
        page.id,
        children.filter((c) => c.id !== draggedId).length,
      );
      if (!expanded) toggleExpanded(page.id);
      return;
    }
    const siblings = childPages(pages, page.parentId).filter(
      (p) => p.id !== draggedId,
    );
    const index = siblings.findIndex((p) => p.id === page.id);
    movePage(
      draggedId,
      page.parentId,
      position === "before" ? index : index + 1,
    );
  };

  if (renaming) {
    return (
      <div
        className={cn(ROW, "bg-surface")}
        style={{ paddingLeft: `${0.5 + depth * 0.75 + 1.25}rem` }}
      >
        <PageIcon icon={page.icon} className="text-muted-foreground" />
        <input
          // biome-ignore lint/a11y/noAutofocus: rename is an explicit action
          autoFocus
          defaultValue={page.title}
          placeholder="Untitled"
          onFocus={(event) => event.currentTarget.select()}
          onBlur={(event) => {
            updatePage(page.id, { title: event.currentTarget.value });
            setRenaming(false);
          }}
          onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setRenaming(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-accent-strong outline-none"
        />
      </div>
    );
  }

  return (
    <>
      <SidebarRow
        href={pageHref(page.id)}
        active={activePageId === page.id}
        depth={depth}
        drop={drop}
        draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(DRAG_MIME, page.id);
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const position = dropPositionFor(event);
          setDrop(
            position === "before" && page.id === HOME_PAGE_ID
              ? "inside"
              : position,
          );
        }}
        onDragLeave={() => setDrop(null)}
        onDrop={onDrop}
        leading={
          <button
            type="button"
            aria-label={expanded ? "Collapse" : "Expand"}
            onClick={() => toggleExpanded(page.id)}
            className={cn(
              "relative z-10 -ml-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted/60",
              children.length === 0 && "invisible",
            )}
          >
            <ChevronRight
              className={cn(
                "size-3 transition-transform",
                expanded && "rotate-90",
              )}
            />
          </button>
        }
        icon={<PageIcon icon={page.icon} />}
        label={pageTitle(page)}
        actions={
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <RowIconButton label="Page actions">
                  <MoreHorizontal className="size-3.5" />
                </RowIconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-52">
                <PageMenuItems
                  pageId={page.id}
                  onRename={() => setRenaming(true)}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <RowIconButton
              label="Add a page inside"
              onClick={() => router.push(pageHref(createPage(page.id)))}
            >
              <Plus className="size-3.5" />
            </RowIconButton>
          </>
        }
      />
      {expanded
        ? children.map((child) => (
            <PageTreeRow
              key={child.id}
              page={child}
              depth={depth + 1}
              activePageId={activePageId}
            />
          ))
        : null}
    </>
  );
}

function TrashPopover() {
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const deletePageForever = useWorkspaceStore((s) => s.deletePageForever);
  const emptyTrash = useWorkspaceStore((s) => s.emptyTrash);
  // Only roots of a trashed subtree: restoring one brings its children back.
  const trashed = Object.values(pages)
    .filter(
      (p) =>
        p.deletedAt &&
        !(p.parentId && pages[p.parentId]?.deletedAt === p.deletedAt),
    )
    .sort((a, b) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? ""));

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={ROW}>
          <Trash2 className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Trash</span>
          {trashed.length ? (
            <span className="text-xs tabular-nums text-muted-foreground">
              {trashed.length}
            </span>
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-80 p-1.5">
        <div className="flex items-center justify-between px-1.5 py-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Trash
          </span>
          {trashed.length ? (
            <Button variant="ghost" size="xs" onClick={emptyTrash}>
              Empty
            </Button>
          ) : null}
        </div>
        {trashed.length === 0 ? (
          <p className="px-1.5 py-4 text-center text-xs text-muted-foreground">
            Empty
          </p>
        ) : (
          <div className="flex max-h-80 flex-col overflow-y-auto">
            {trashed.map((page) => (
              <div
                key={page.id}
                className="group/trash flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-surface"
              >
                <PageIcon icon={page.icon} className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-accent-strong">
                  {pageTitle(page)}
                </span>
                <RowIconButton
                  label="Restore"
                  onClick={() => restorePage(page.id)}
                >
                  <RotateCcw className="size-3.5" />
                </RowIconButton>
                <RowIconButton
                  label="Delete forever"
                  onClick={() => deletePageForever(page.id)}
                >
                  <Trash2 className="size-3.5" />
                </RowIconButton>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function HiddenModulesPopover() {
  const { sidebarModules } = useWorkspaceNav();
  const hidden = useWorkspaceStore((s) => s.workspace.sidebar.hiddenModules);
  const setModuleHidden = useWorkspaceStore((s) => s.setModuleHidden);
  if (hidden.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={ROW}>
          <EyeOff className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Hidden</span>
          <span className="text-xs tabular-nums text-muted-foreground">
            {hidden.length}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" className="w-64 p-1.5">
        {sidebarModules
          .filter((m) => hidden.includes(m.id))
          .map((module) => {
            const Icon = module.icon;
            return (
              <div
                key={module.id}
                className="flex h-8 items-center gap-2 rounded-md px-1.5 text-[13px] hover:bg-surface"
              >
                <Icon className="size-4 text-muted-foreground" />
                <span className="flex-1 truncate text-accent-strong">
                  {module.label}
                </span>
                <RowIconButton
                  label="Show"
                  onClick={() => setModuleHidden(module.id, false)}
                >
                  <Eye className="size-3.5" />
                </RowIconButton>
              </div>
            );
          })}
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceSidebarContent({
  onNavigate,
}: {
  /** Called after a row is clicked, so the mobile sheet can close. */
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const { pageHref, resolveRef, moduleForPath, sidebarModules, routes } =
    useWorkspaceNav();
  const { pathname, pageId: activePageId } = useActiveLocation();
  const workspace = useWorkspaceStore((s) => s.workspace);
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const toggleSection = useWorkspaceStore((s) => s.toggleSection);
  const toggleFavorite = useWorkspaceStore((s) => s.toggleFavorite);
  const setModuleHidden = useWorkspaceStore((s) => s.setModuleHidden);
  const createPage = useWorkspaceStore((s) => s.createPage);
  const { sidebar, pages, favorites } = workspace;
  const activeModule = activePageId ? undefined : moduleForPath(pathname);

  const favoriteRows = favorites
    .map((ref) => resolveRef(ref, pages))
    .filter((r) => r !== null);
  const rootPages = childPages(pages, null);
  const templates = templatePages(pages);
  const instantiateTemplate = useWorkspaceStore((s) => s.instantiateTemplate);
  const openTemplates = useTemplatePicker((s) => s.open);
  const newFromTemplate = () =>
    openTemplates({
      use: "page",
      onPick: async (templateId, inputs) => {
        const id = await instantiateTemplate(templateId, null, inputs);
        if (id) {
          router.push(pageHref(id));
          onNavigate?.();
        }
      },
    });
  const [triggersOpen, setTriggersOpen] = useState(false);
  const pagesCollapsed = sidebar.collapsedSections.includes("pages");
  const templatesCollapsed = sidebar.collapsedSections.includes("templates");
  const favoritesCollapsed = sidebar.collapsedSections.includes("favorites");

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onClickCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("a")) {
          onNavigate?.();
        }
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Image
          src="/favicon.ico"
          alt=""
          width={18}
          height={18}
          className="rounded"
        />
        <span className="flex-1 truncate text-[13px] font-semibold text-accent-strong">
          denizlg24
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Collapse sidebar"
          className="text-muted-foreground"
          onClick={toggleSidebar}
        >
          <ChevronsLeft />
        </Button>
      </div>

      <div className="flex shrink-0 flex-col gap-px px-2 pb-1">
        <button
          type="button"
          className={ROW}
          onClick={() => window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE))}
        >
          <Search className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Search</span>
          <Kbd className="h-4 text-[10px]">⌘P</Kbd>
        </button>
        <button
          type="button"
          className={ROW}
          onClick={() => {
            router.push(pageHref(createPage(null)));
            onNavigate?.();
          }}
        >
          <Plus className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">New page</span>
        </button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3">
        {favoriteRows.length > 0 ? (
          <div className="flex flex-col gap-px">
            <SectionHeader
              label="Favorites"
              collapsed={favoritesCollapsed}
              onToggle={() => toggleSection("favorites")}
            />
            {!favoritesCollapsed
              ? favoriteRows.map((resolved) => (
                  <SidebarRow
                    key={resolved.ref}
                    href={resolved.href}
                    active={
                      resolved.kind === "page"
                        ? resolved.page.id === activePageId
                        : resolved.module.id === activeModule?.id
                    }
                    icon={<RefIcon resolved={resolved} />}
                    label={resolved.label}
                    actions={
                      <RowIconButton
                        label="Remove from favorites"
                        onClick={() => toggleFavorite(resolved.ref)}
                      >
                        <StarOff className="size-3.5" />
                      </RowIconButton>
                    }
                  />
                ))
              : null}
          </div>
        ) : null}

        <div className="flex flex-col gap-px">
          <SectionHeader
            label="Pages"
            collapsed={pagesCollapsed}
            onToggle={() => toggleSection("pages")}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <RowIconButton label="New page">
                    <Plus className="size-3.5" />
                  </RowIconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-44">
                  <DropdownMenuItem
                    onSelect={() => router.push(pageHref(createPage(null)))}
                  >
                    <FileText />
                    Page
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={newFromTemplate}>
                    <LayoutTemplate />
                    From template
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
          {!pagesCollapsed
            ? rootPages.map((page) => (
                <PageTreeRow
                  key={page.id}
                  page={page}
                  depth={0}
                  activePageId={activePageId}
                />
              ))
            : null}
        </div>

        {templates.length > 0 ? (
          <div className="flex flex-col gap-px">
            <SectionHeader
              label="Templates"
              collapsed={templatesCollapsed}
              onToggle={() => toggleSection("templates")}
            />
            {!templatesCollapsed
              ? templates.map((page) => (
                  <PageTreeRow
                    key={page.id}
                    page={page}
                    depth={0}
                    activePageId={activePageId}
                  />
                ))
              : null}
          </div>
        ) : null}

        {MODULE_SECTIONS.map((section) => {
          const modules = sidebarModules.filter(
            (m) =>
              m.section === section.id && !sidebar.hiddenModules.includes(m.id),
          );
          if (modules.length === 0) return null;
          const collapsed = sidebar.collapsedSections.includes(section.id);
          return (
            <div key={section.id} className="flex flex-col gap-px">
              <SectionHeader
                label={section.label}
                collapsed={collapsed}
                onToggle={() => toggleSection(section.id)}
              />
              {!collapsed
                ? modules.map((module) => {
                    const Icon = module.icon;
                    const ref = moduleRef(module.id);
                    const favorite = favorites.includes(ref);
                    return (
                      <SidebarRow
                        key={module.id}
                        href={module.href}
                        active={activeModule?.id === module.id}
                        icon={<Icon className="size-4" />}
                        label={module.label}
                        actions={
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <RowIconButton label={`${module.label} actions`}>
                                <MoreHorizontal className="size-3.5" />
                              </RowIconButton>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="start"
                              className="min-w-48"
                            >
                              <DropdownMenuItem
                                onSelect={() => toggleFavorite(ref)}
                              >
                                {favorite ? <StarOff /> : <Star />}
                                {favorite
                                  ? "Remove from favorites"
                                  : "Add to favorites"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() =>
                                  setModuleHidden(module.id, true)
                                }
                              >
                                <EyeOff />
                                Hide in sidebar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        }
                      />
                    );
                  })
                : null}
            </div>
          );
        })}
      </nav>

      <div className="flex shrink-0 flex-col gap-px border-t px-2 py-2">
        <HiddenModulesPopover />
        <button
          type="button"
          className={ROW}
          onClick={() => setTriggersOpen(true)}
        >
          <Zap className="size-4 text-muted-foreground" />
          <span className="flex-1 text-left">Triggers</span>
        </button>
        <TrashPopover />
        <TemplatePicker use="page" />
        <TriggersDialog open={triggersOpen} onOpenChange={setTriggersOpen} />
        <SidebarRow
          href={routes.settings}
          active={pathname.startsWith(routes.settings)}
          icon={<Settings className="size-4" />}
          label="Settings"
        />
      </div>
    </div>
  );
}

/** The resizable, collapsible sidebar on desktop-width windows. */
export function WorkspaceSidebar() {
  const ready = useWorkspaceStore((s) => s.ready);
  const width = useWorkspaceStore((s) => s.workspace.sidebar.width);
  const collapsed = useWorkspaceStore((s) => s.workspace.sidebar.collapsed);
  const setSidebar = useWorkspaceStore((s) => s.setSidebar);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const startRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "\\" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        useWorkspaceStore.getState().toggleSidebar();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);

  if (collapsed) return null;
  if (!ready) {
    // Holds the column so the page doesn't jump when the stored workspace lands.
    return (
      <aside
        className="hidden h-full shrink-0 border-r bg-sidebar md:block"
        style={{ width }}
      />
    );
  }

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = { x: event.clientX, width };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!startRef.current) return;
    setDragWidth(startRef.current.width + event.clientX - startRef.current.x);
  };
  const onPointerUp = () => {
    if (dragWidth !== null) setSidebar({ width: dragWidth });
    startRef.current = null;
    setDragWidth(null);
  };

  return (
    <aside
      className="relative hidden h-full shrink-0 border-r bg-sidebar md:block"
      style={{ width: Math.min(420, Math.max(200, dragWidth ?? width)) }}
    >
      <WorkspaceSidebarContent />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={() => setSidebar({ width: SIDEBAR_DEFAULT_WIDTH })}
        className="absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize transition-colors hover:bg-border/60 active:bg-border"
      />
    </aside>
  );
}

/** The sidebar on narrow windows: a sheet opened from the page header's trigger. */
export function WorkspaceMobileSidebar() {
  const open = useMobileSidebar((s) => s.open);
  const setOpen = useMobileSidebar((s) => s.setOpen);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-72 gap-0 p-0 sm:max-w-72"
        aria-describedby={undefined}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <WorkspaceSidebarContent onNavigate={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
