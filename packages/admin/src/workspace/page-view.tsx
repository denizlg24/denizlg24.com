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
import { Lock, MoreHorizontal, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAdmin } from "../provider";
import { FlowEditor } from "./editor/flow-editor";
import { PageMenuItems } from "./page-actions";
import { IconPicker, PageIcon } from "./page-icon";
import { pageTitle } from "./refs";
import { pageAncestors, useWorkspaceStore } from "./store";
import { useWorkspaceNav } from "./use-workspace-nav";

function TitleArea({ page }: { page: WorkspacePage }) {
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const [title, setTitle] = useState(page.title);

  useEffect(() => setTitle(page.title), [page.title]);

  return (
    <div className="flex flex-col gap-3 pt-6">
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
          {page.icon ?? (
            <>
              <PageIcon icon={null} className="size-3.5" />
              Add icon
            </>
          )}
        </button>
      </IconPicker>
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
        className="w-full bg-transparent text-[2.25rem] font-semibold leading-tight tracking-tight text-accent-strong outline-none placeholder:text-muted-foreground/40"
      />
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
            <DropdownMenuCheckboxItem
              checked={page.fullWidth}
              onCheckedChange={(fullWidth) =>
                updatePage(page.id, { fullWidth: fullWidth === true })
              }
            >
              Full width
            </DropdownMenuCheckboxItem>
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

      <PageBody width={page.fullWidth ? "full" : "wide"} className="gap-6 pb-0">
        <TitleArea page={page} />
        <div className="pl-6">
          <FlowEditor pageId={page.id} editable={!page.locked} />
        </div>
      </PageBody>
    </Page>
  );
}
