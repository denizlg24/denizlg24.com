"use client";

import type { WorkspacePage } from "@repo/schemas";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { EmptyState } from "@repo/ui/empty-state";
import { Page, PageBody, PageHeader } from "@repo/ui/page";
import { cn } from "@repo/ui/utils";
import { ImageIcon, Lock, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdmin } from "../provider";
import { useActiveTheme } from "./appearance/store";
import { FlowEditor } from "./editor/flow-editor";
import { PageMenuItems } from "./page-actions";
import { AppIcon, IconPicker, PageIcon } from "./page-icon";
import {
  CoverPicker,
  effectiveWidth,
  PageCover,
  PageStyleMenuItems,
  pageFontStyle,
  usePageTheme,
  WIDTH_CLASS,
} from "./page-style";
import { pageTitle } from "./refs";
import { pageAncestors, useWorkspaceStore } from "./store";
import { useWorkspaceNav } from "./use-workspace-nav";

function TitleArea({ page }: { page: WorkspacePage }) {
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const ornament = useActiveTheme().ornament.title;
  const [title, setTitle] = useState(page.title);

  useEffect(() => setTitle(page.title), [page.title]);

  return (
    <div
      className={cn(
        "relative z-10 flex flex-col gap-3",
        page.style?.cover ? (page.icon ? "-mt-14" : "pt-2") : "pt-6",
      )}
    >
      <div className="flex items-center gap-1">
        <IconPicker
          value={page.icon}
          onChange={(icon) => updatePage(page.id, { icon })}
        >
          <button
            type="button"
            aria-label="Change icon"
            disabled={page.locked}
            className={cn(
              "flex w-fit items-center rounded-md transition-colors hover:bg-surface",
              page.icon
                ? "-ml-1 p-1 text-5xl leading-none"
                : "h-6 gap-1.5 px-1.5 text-xs text-muted-foreground",
            )}
          >
            {page.icon ? (
              <AppIcon value={page.icon} className="size-14 text-5xl" />
            ) : (
              <>
                <PageIcon icon={null} className="size-3.5" />
                Add icon
              </>
            )}
          </button>
        </IconPicker>
        {!page.style?.cover && !page.locked ? (
          <CoverPicker page={page}>
            <button
              type="button"
              className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:bg-surface group-hover/title:opacity-100"
            >
              <ImageIcon className="size-3.5" />
              Add cover
            </button>
          </CoverPicker>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        {ornament ? (
          <AppIcon value={ornament} className="size-8 shrink-0" />
        ) : null}
        <input
          value={title}
          placeholder="Untitled"
          readOnly={page.locked}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => {
            if (title !== page.title) updatePage(page.id, { title });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="theme-heading w-full bg-transparent text-[2.25rem] font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/40"
        />
      </div>
    </div>
  );
}

export function WorkspacePageView({ pageId }: { pageId: string }) {
  const router = useRouter();
  const { slots } = useAdmin();
  const { pageHref } = useWorkspaceNav();
  const sidebarTrigger = slots?.sidebarTrigger;
  const ready = useWorkspaceStore((s) => s.ready);
  const error = useWorkspaceStore((s) => s.error);
  const refresh = useWorkspaceStore((s) => s.refresh);
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const restorePage = useWorkspaceStore((s) => s.restorePage);
  const ensurePage = useWorkspaceStore((s) => s.ensurePage);
  const blocksLoaded = useWorkspaceStore((s) => pageId in s.loaded);
  const page = pages[pageId];
  usePageTheme(page && !page.deletedAt ? page : undefined);

  useEffect(() => {
    if (ready) void ensurePage(pageId);
  }, [ready, pageId, ensurePage]);

  if (!ready || (page && !blocksLoaded)) {
    if (!error) return null;
    return (
      <Page>
        <PageHeader leading={sidebarTrigger} title="Workspace" />
        <PageBody>
          <EmptyState
            label={error}
            action={
              <Button variant="outline" onClick={() => void refresh()}>
                Retry
              </Button>
            }
          />
        </PageBody>
      </Page>
    );
  }

  if (!page) {
    return (
      <Page>
        <PageHeader leading={sidebarTrigger} title="Not found" />
        <PageBody>
          <EmptyState label="This page doesn't exist" />
        </PageBody>
      </Page>
    );
  }

  if (page.deletedAt) {
    return (
      <Page>
        <PageHeader leading={sidebarTrigger} title={pageTitle(page)} />
        <PageBody>
          <EmptyState
            icon={<Trash2 />}
            label="In the trash"
            action={
              <Button variant="outline" onClick={() => restorePage(page.id)}>
                Restore
              </Button>
            }
          />
        </PageBody>
      </Page>
    );
  }

  const ancestors = pageAncestors(pages, page.id);

  return (
    <Page>
      <PageHeader
        leading={sidebarTrigger}
        crumbs={ancestors.map((a) => ({
          label: (
            <span className="flex items-center gap-1.5">
              <PageIcon icon={a.icon} className="text-muted-foreground" />
              {pageTitle(a)}
            </span>
          ),
          onClick: () => router.push(pageHref(a.id)),
        }))}
        icon={<PageIcon icon={page.icon} />}
        title={pageTitle(page)}
      >
        {page.locked ? (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => updatePage(page.id, { locked: false })}
          >
            <Lock />
            Locked
          </Button>
        ) : null}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Page options"
              className="text-muted-foreground"
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <PageStyleMenuItems page={page} />
            <DropdownMenuCheckboxItem
              checked={page.locked}
              onCheckedChange={(value) =>
                updatePage(page.id, { locked: value === true })
              }
            >
              Lock page
            </DropdownMenuCheckboxItem>
            <DropdownMenuSeparator />
            <PageMenuItems pageId={page.id} />
          </DropdownMenuContent>
        </DropdownMenu>
      </PageHeader>

      <div
        data-slot="page-body"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <PageCover page={page} editable={!page.locked} />
        <div
          className={cn(
            "group/title mx-auto flex w-full flex-col gap-6 px-5 pt-6 pb-0 sm:px-8",
            WIDTH_CLASS[effectiveWidth(page)],
          )}
          style={pageFontStyle(page.style)}
        >
          {page.style?.hideTitle ? null : <TitleArea page={page} />}
          <div className="pl-6">
            <FlowEditor pageId={page.id} editable={!page.locked} />
          </div>
        </div>
      </div>
    </Page>
  );
}
