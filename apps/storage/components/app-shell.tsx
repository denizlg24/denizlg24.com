"use client";

import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@repo/ui/sheet";
import { PanelLeft, Search, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";
import { FolderTree } from "./folder-tree";
import { SearchPalette, useSearchHotkey } from "./search-palette";
import { useSession } from "./session-provider";
import { UploadDock } from "./upload-dock";

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const params = useParams<{ id?: string }>();
  const [searchOpen, setSearchOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const currentFolderId = params?.id ?? null;

  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchHotkey(openSearch);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3 md:px-4">
          <Sheet open={navOpen} onOpenChange={setNavOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 md:hidden"
                aria-label="Open folders"
              >
                <PanelLeft className="size-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="border-b px-4 py-3 text-sm">
                Folders
              </SheetTitle>
              <div className="scrollbar-thin overflow-y-auto">
                <FolderTree
                  currentFolderId={currentFolderId}
                  onNavigate={() => setNavOpen(false)}
                />
              </div>
            </SheetContent>
          </Sheet>

          <Link href="/" className="text-sm font-semibold tracking-tight">
            deniz<span className="text-muted-foreground">cloud</span>
          </Link>

          <button
            type="button"
            onClick={openSearch}
            className="ml-auto flex h-8 max-w-xs flex-1 items-center gap-2 rounded-md border px-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 md:ml-6 md:mr-auto"
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate">Search files</span>
            <kbd className="ml-auto hidden shrink-0 rounded border px-1 font-mono text-[10px] sm:block">
              ⌘K
            </kbd>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-8 shrink-0"
                aria-label="Account"
              >
                <UserRound className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="font-normal">
                <span className="block truncate text-sm">{user.username}</span>
                {user.email && (
                  <span className="block truncate text-xs text-muted-foreground">
                    {user.email}
                  </span>
                )}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href="/account">Account settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void signOut()}>
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="scrollbar-thin hidden w-60 shrink-0 overflow-y-auto border-r md:block">
          <FolderTree currentFolderId={currentFolderId} />
        </aside>
        <main className="flex min-w-0 flex-1 flex-col">{children}</main>
      </div>

      <SearchPalette open={searchOpen} onOpenChange={setSearchOpen} />
      <UploadDock />
    </div>
  );
}
