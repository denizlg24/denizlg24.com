"use client";

import { ThemeToggle } from "@repo/cloud-ui/theme";
import { BottomTabBar } from "@repo/ui/bottom-tab-bar";
import { Button } from "@repo/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@repo/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle } from "@repo/ui/sheet";
import { cn } from "@repo/ui/utils";
import {
  Camera,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderPlus,
  FolderUp,
  HardDrive,
  Images,
  Link2,
  LogOut,
  MonitorSmartphone,
  MoreHorizontal,
  Plus,
  Search,
  Settings,
  Upload,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useRouter } from "next/navigation";
import { type ReactNode, useCallback, useState } from "react";
import { type BrowserCommand, browserCommands } from "@/lib/browser-commands";
import { keepClaimedFocus } from "@/lib/focus-claim";
import { useRoots, userRootId } from "@/lib/queries";
import { FolderTree } from "./folder-tree";
import { SearchPalette, useSearchHotkey } from "./search-palette";
import { useSession } from "./session-provider";
import { UploadPanel } from "./upload-panel";

function NavLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: typeof HardDrive;
  label: string;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md px-2.5 text-sm transition-colors",
        active ? "bg-muted font-medium" : "hover:bg-muted/60",
      )}
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

/**
 * The Upload menu is the one primary action in the app. It acts on the
 * folder that is open; anywhere else it says so rather than doing nothing.
 */
function UploadMenu({ inFolder }: { inFolder: boolean }) {
  const emit = (command: BrowserCommand) => browserCommands.emit(command);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5" disabled={!inFolder}>
          <Upload className="size-4" />
          Upload
          <ChevronDown className="size-3.5 opacity-70" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-48"
        onCloseAutoFocus={keepClaimedFocus}
      >
        <DropdownMenuItem onSelect={() => emit("upload-files")}>
          <Upload className="size-4" />
          Files
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => emit("upload-folder")}>
          <FolderUp className="size-4" />
          Folder
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => emit("new-folder")}>
          <FolderPlus className="size-4" />
          New folder
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession();
  const params = useParams<{ id?: string }>();
  const pathname = usePathname();
  const router = useRouter();
  const roots = useRoots();
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const currentFolderId = params?.id ?? null;
  const inFolder = pathname.startsWith("/folders/");

  const openSearch = useCallback(() => setSearchOpen(true), []);
  useSearchHotkey(openSearch);

  const myFilesId = userRootId(roots);
  const familyId = roots && "sharedRoot" in roots ? roots.sharedRoot.id : null;
  const isMyFiles = currentFolderId !== null && currentFolderId === myFilesId;
  const isFamily = currentFolderId !== null && currentFolderId === familyId;
  // A subfolder still belongs to one of the two roots; the tree marks the
  // exact folder, the top links mark the drive.
  const currentDrive: "mine" | "family" | null = isMyFiles
    ? "mine"
    : isFamily
      ? "family"
      : null;

  const emitAdd = (command: BrowserCommand) => {
    setAddOpen(false);
    browserCommands.emit(command);
  };

  return (
    <div className="flex h-dvh flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 flex-col border-r md:flex">
          <div className="flex h-14 items-center justify-between gap-2 px-4">
            <Link
              href="/"
              className="truncate text-base font-semibold tracking-tight"
            >
              Deniz Cloud
            </Link>
            <UploadMenu inFolder={inFolder} />
          </div>
          <nav
            className="flex flex-col gap-0.5 px-2 pb-2"
            aria-label="Sections"
          >
            <NavLink
              href={myFilesId ? `/folders/${myFilesId}` : "/"}
              icon={HardDrive}
              label="My files"
              active={currentDrive === "mine"}
            />
            {familyId && (
              <NavLink
                href={`/folders/${familyId}`}
                icon={Users}
                label="Family"
                active={currentDrive === "family"}
              />
            )}
            <NavLink
              href="/recent"
              icon={Clock}
              label="Recent"
              active={pathname === "/recent"}
            />
            <NavLink
              href="/shares"
              icon={Link2}
              label="Shared links"
              active={pathname === "/shares"}
            />
          </nav>
          <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto border-t">
            <FolderTree currentFolderId={currentFolderId} />
          </div>
          <nav
            className="flex flex-col gap-0.5 border-t px-2 pt-2"
            aria-label="Account"
          >
            <NavLink
              href="/devices"
              icon={MonitorSmartphone}
              label="Devices"
              active={pathname === "/devices"}
            />
            <NavLink
              href="/settings"
              icon={Settings}
              label="Settings"
              active={pathname === "/settings"}
            />
          </nav>
          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 text-left text-sm transition-colors hover:bg-muted/60"
                  aria-label="Account"
                >
                  <Avatar username={user.username} />
                  <span className="truncate">{user.username}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <span className="block truncate text-sm">
                    {user.username}
                  </span>
                  {user.email && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <Settings className="size-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void signOut()}>
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <ThemeToggle className="size-8 shrink-0" />
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:px-6">
            <Link
              href="/"
              className="truncate text-base font-semibold tracking-tight md:hidden"
            >
              Deniz Cloud
            </Link>
            <button
              type="button"
              onClick={openSearch}
              className="ml-auto flex h-9 w-full max-w-xl items-center gap-2 rounded-lg border bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60 md:mx-auto"
            >
              <Search className="size-4 shrink-0" />
              <span className="truncate">Search your files</span>
              <kbd className="ml-auto hidden shrink-0 rounded border px-1.5 font-mono text-[11px] sm:block">
                ⌘K
              </kbd>
            </button>
          </header>
          <main className="flex min-h-0 min-w-0 flex-1 flex-col pb-16 md:pb-0">
            {children}
          </main>
        </div>
      </div>

      <BottomTabBar className="md:hidden">
        <ul className="grid h-16 grid-cols-5">
          <TabItem
            href={myFilesId ? `/folders/${myFilesId}` : "/"}
            icon={HardDrive}
            label="My files"
            active={currentDrive === "mine"}
          />
          <TabItem
            href={familyId ? `/folders/${familyId}` : "/"}
            icon={Users}
            label="Family"
            active={currentDrive === "family"}
          />
          <TabItem
            href="/recent"
            icon={Clock}
            label="Recent"
            active={pathname === "/recent"}
          />
          <li>
            <button
              type="button"
              onClick={openSearch}
              className="flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground"
            >
              <Search className="size-5" />
              Search
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className={cn(
                "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]",
                ["/shares", "/devices", "/settings"].includes(pathname)
                  ? "text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <MoreHorizontal className="size-5" />
              More
            </button>
          </li>
        </ul>
      </BottomTabBar>

      {inFolder && (
        <Button
          size="icon"
          aria-label="Add"
          className="fixed bottom-20 right-4 z-40 size-14 rounded-full shadow-lg md:hidden"
          onClick={() => setAddOpen(true)}
        >
          <Plus className="size-6" />
        </Button>
      )}

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          className="gap-0 rounded-t-2xl px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/30"
          />
          <SheetTitle className="sr-only">More</SheetTitle>
          <div className="flex items-center gap-3 px-3 py-2">
            <Avatar username={user.username} className="size-9 text-sm" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.username}</p>
              {user.email && (
                <p className="truncate text-xs text-muted-foreground">
                  {user.email}
                </p>
              )}
            </div>
            <ThemeToggle className="ml-auto size-9 shrink-0" />
          </div>
          <nav className="mt-1 flex flex-col" aria-label="More">
            <SheetLink
              href="/shares"
              icon={Link2}
              label="Shared links"
              active={pathname === "/shares"}
              onNavigate={() => setMoreOpen(false)}
            />
            <SheetLink
              href="/devices"
              icon={MonitorSmartphone}
              label="Devices"
              active={pathname === "/devices"}
              onNavigate={() => setMoreOpen(false)}
            />
            <SheetLink
              href="/settings"
              icon={Settings}
              label="Settings"
              active={pathname === "/settings"}
              onNavigate={() => setMoreOpen(false)}
            />
          </nav>
          <div className="mx-3 my-1 border-t" />
          <button
            type="button"
            className="flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground"
            onClick={() => void signOut()}
          >
            <LogOut className="size-4" />
            Sign out
          </button>
        </SheetContent>
      </Sheet>

      <Sheet open={addOpen} onOpenChange={setAddOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onCloseAutoFocus={keepClaimedFocus}
          className="gap-0 rounded-t-2xl px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-2 h-1 w-9 rounded-full bg-muted-foreground/30"
          />
          <SheetTitle className="px-3 py-2 text-sm font-medium">
            Add to this folder
          </SheetTitle>
          <div className="flex flex-col">
            <SheetAction
              icon={Camera}
              label="Take photo"
              onClick={() => emitAdd("take-photo")}
            />
            <SheetAction
              icon={Images}
              label="Choose photos"
              onClick={() => emitAdd("upload-photos")}
            />
            <SheetAction
              icon={Upload}
              label="Choose files"
              onClick={() => emitAdd("upload-files")}
            />
            <SheetAction
              icon={FolderPlus}
              label="New folder"
              onClick={() => emitAdd("new-folder")}
            />
          </div>
        </SheetContent>
      </Sheet>

      <SearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onSubmit={(q, scope) => {
          setSearchOpen(false);
          router.push(`/search?q=${encodeURIComponent(q)}&scope=${scope}`);
        }}
      />
      <UploadPanel />
    </div>
  );
}

function TabItem({
  href,
  icon: Icon,
  label,
  active,
}: {
  href: string;
  icon: typeof HardDrive;
  label: string;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} />
        {label}
      </Link>
    </li>
  );
}

function SheetLink({
  href,
  icon: Icon,
  label,
  active,
  onNavigate,
}: {
  href: string;
  icon: typeof HardDrive;
  label: string;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-11 items-center gap-3 rounded-lg px-3 text-sm",
        active ? "bg-muted font-medium" : "hover:bg-muted/60",
      )}
    >
      <Icon className="size-4 text-muted-foreground" />
      <span className="flex-1">{label}</span>
      <ChevronRight className="size-4 text-muted-foreground/60" />
    </Link>
  );
}

function SheetAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof HardDrive;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-11 items-center gap-3 rounded-lg px-3 text-left text-sm hover:bg-muted/60"
    >
      <Icon className="size-4 text-muted-foreground" />
      {label}
    </button>
  );
}

function Avatar({
  username,
  className,
}: {
  username: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold uppercase text-primary-foreground",
        className,
      )}
    >
      {username.slice(0, 1)}
    </span>
  );
}
