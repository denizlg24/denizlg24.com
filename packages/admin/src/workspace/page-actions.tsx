"use client";

import { HOME_PAGE_ID, pageRef } from "@repo/schemas";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@repo/ui/dropdown-menu";
import {
  Copy,
  CornerUpRight,
  FilePlus2,
  LayoutTemplate,
  Link2,
  PencilLine,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageIcon } from "./page-icon";
import { pageTitle } from "./refs";
import { childPages, descendantIds, useWorkspaceStore } from "./store";
import { useWorkspaceNav } from "./use-workspace-nav";

/** The menu a page offers everywhere it appears: sidebar row, page header. */
export function PageMenuItems({
  pageId,
  onRename,
}: {
  pageId: string;
  onRename?: () => void;
}) {
  const router = useRouter();
  const { pageHref, routes } = useWorkspaceNav();
  const pages = useWorkspaceStore((s) => s.workspace.pages);
  const favorites = useWorkspaceStore((s) => s.workspace.favorites);
  const toggleFavorite = useWorkspaceStore((s) => s.toggleFavorite);
  const duplicatePage = useWorkspaceStore((s) => s.duplicatePage);
  const trashPage = useWorkspaceStore((s) => s.trashPage);
  const movePage = useWorkspaceStore((s) => s.movePage);
  const updatePage = useWorkspaceStore((s) => s.updatePage);
  const instantiateTemplate = useWorkspaceStore((s) => s.instantiateTemplate);

  const page = pages[pageId];
  if (!page) return null;
  const ref = pageRef(pageId);
  const favorite = favorites.includes(ref);
  const isHome = pageId === HOME_PAGE_ID;
  const blocked = new Set(descendantIds(pages, pageId));
  const targets = Object.values(pages)
    .filter((p) => !p.deletedAt && !blocked.has(p.id) && p.id !== page.parentId)
    .sort((a, b) => pageTitle(a).localeCompare(pageTitle(b)));

  return (
    <>
      <DropdownMenuItem onSelect={() => toggleFavorite(ref)}>
        {favorite ? <StarOff /> : <Star />}
        {favorite ? "Remove from favorites" : "Add to favorites"}
      </DropdownMenuItem>
      {onRename ? (
        <DropdownMenuItem onSelect={onRename}>
          <PencilLine />
          Rename
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        onSelect={() => {
          const id = duplicatePage(pageId);
          if (id) router.push(pageHref(id));
        }}
      >
        <Copy />
        Duplicate
      </DropdownMenuItem>
      {page.template ? (
        <DropdownMenuItem
          onSelect={() => {
            void instantiateTemplate(pageId, null, {}).then((id) => {
              if (id) router.push(pageHref(id));
            });
          }}
        >
          <FilePlus2 />
          New page from template
        </DropdownMenuItem>
      ) : null}
      {!isHome ? (
        <DropdownMenuItem
          onSelect={() => updatePage(pageId, { template: !page.template })}
        >
          <LayoutTemplate />
          {page.template ? "Stop using as template" : "Use as template"}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        onSelect={() => {
          void navigator.clipboard
            .writeText(pageHref(pageId))
            .then(() => toast.success("Link copied"));
        }}
      >
        <Link2 />
        Copy link
      </DropdownMenuItem>
      {!isHome ? (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CornerUpRight />
            Move to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 min-w-48 overflow-y-auto">
            {page.parentId ? (
              <DropdownMenuItem
                onSelect={() =>
                  movePage(pageId, null, childPages(pages, null).length)
                }
              >
                Top level
              </DropdownMenuItem>
            ) : null}
            {targets.map((target) => (
              <DropdownMenuItem
                key={target.id}
                onSelect={() =>
                  movePage(
                    pageId,
                    target.id,
                    childPages(pages, target.id).length,
                  )
                }
              >
                <PageIcon
                  icon={target.icon}
                  className="text-muted-foreground"
                />
                <span className="truncate">{pageTitle(target)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ) : null}
      {!isHome ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => {
              const parent = page.parentId;
              trashPage(pageId);
              toast("Moved to trash", {
                action: {
                  label: "Undo",
                  onClick: () =>
                    useWorkspaceStore.getState().restorePage(pageId),
                },
              });
              const { pathname, search } = window.location;
              const open = routes.workspace.pageAt(
                pathname,
                new URLSearchParams(search),
              );
              if (open === pageId) {
                router.push(parent ? pageHref(parent) : pageHref(HOME_PAGE_ID));
              }
            }}
          >
            <Trash2 />
            Move to trash
          </DropdownMenuItem>
        </>
      ) : null}
    </>
  );
}
