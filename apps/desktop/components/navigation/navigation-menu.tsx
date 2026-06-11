"use client";

import type { LucideIcon } from "lucide-react";
import {
  AlarmClock,
  Brain,
  Briefcase,
  Calendar,
  CalendarDays,
  ChevronRight,
  Clock,
  FileText,
  FolderGit2,
  HomeIcon,
  Inbox,
  Kanban,
  KeyRound,
  MessageCircle,
  NotebookPen,
  PenTool,
  Plus,
  Radio,
  Settings,
  Table,
  UserSquare,
  UsersRound,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";

export type NavChild = {
  label: string;
  href: string;
  icon: LucideIcon;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavChild[];
};

export type NavGroup = {
  groupLabel: string;
  items: NavItem[];
};

export const DASHBOARD_PREFIX = "/dashboard";

export const GROUPS: NavGroup[] = [
  {
    groupLabel: "Portfolio",
    items: [
      {
        label: "Blog",
        href: "",
        icon: NotebookPen,
        children: [
          {
            label: "All Posts",
            href: "/blog",
            icon: HomeIcon,
          },
          {
            label: "New",
            href: "/blog/new",
            icon: Plus,
          },
          {
            label: "Comments",
            href: "/blog/comments",
            icon: MessageCircle,
          },
        ],
      },
      {
        label: "Projects",
        href: "",
        icon: FolderGit2,
        children: [
          {
            label: "All Projects",
            href: "/projects",
            icon: HomeIcon,
          },
          {
            label: "New",
            href: "/projects/new",
            icon: Plus,
          },
        ],
      },
      {
        label: "Timeline",
        href: "",
        icon: Briefcase,
        children: [
          {
            label: "All Items",
            href: "/timeline",
            icon: HomeIcon,
          },
          {
            label: "New",
            href: "/timeline/new",
            icon: Plus,
          },
        ],
      },
      {
        label: "Now Page",
        href: "/now",
        icon: Clock,
      },
    ],
  },
  {
    groupLabel: "Contacts",
    items: [
      {
        label: "Contacts",
        href: "/contacts",
        icon: UserSquare,
      },
      {
        label: "Inbox",
        href: "/inbox",
        icon: Inbox,
      },
      {
        label: "Triage",
        href: "",
        icon: Brain,
        children: [
          {
            label: "Review",
            href: "/triage",
            icon: Inbox,
          },
          {
            label: "Settings",
            href: "/triage/settings",
            icon: Settings,
          },
        ],
      },
    ],
  },
  {
    groupLabel: "Schedule",
    items: [
      {
        label: "Calendar",
        href: "/calendar",
        icon: Calendar,
      },
      {
        label: "Timetable",
        href: "/timetable",
        icon: CalendarDays,
      },
    ],
  },
  {
    groupLabel: "Personal",
    items: [
      {
        label: "Journal",
        href: "/journal",
        icon: NotebookPen,
      },
      {
        label: "Notes",
        href: "/notes",
        icon: FileText,
      },
      {
        label: "People",
        href: "/people",
        icon: UsersRound,
      },
      {
        label: "Whiteboard",
        href: "",
        icon: PenTool,
        children: [
          {
            label: "All Whiteboards",
            href: "/whiteboard",
            icon: PenTool,
          },
          {
            label: "Today's Whiteboard",
            href: "/whiteboard/today",
            icon: Clock,
          },
        ],
      },
      {
        label: "Kanban Boards",
        href: "/kanban",
        icon: Kanban,
      },
      {
        label: "Spreadsheets",
        href: "/spreadsheets",
        icon: Table,
      },
    ],
  },
  {
    groupLabel: "Utilities",
    items: [
      {
        label: "Pomodoro Timer",
        href: "/pomodoro",
        icon: AlarmClock,
      },
      {
        label: "Resources",
        href: "/resources",
        icon: Radio,
      },
      {
        label: "Authenticator",
        href: "/authenticator",
        icon: KeyRound,
      },
    ],
  },
  {
    groupLabel: "App",
    items: [
      {
        label: "Token Usage",
        href: "/llm-usage",
        icon: Brain,
      },
      {
        label: "Settings",
        href: "/settings",
        icon: Settings,
      },
    ],
  },
];

export function NavigationMenu() {
  const pathname = usePathname();

  return (
    <Sidebar collapsible="icon" className="top-8 h-[calc(100vh-2rem)]!">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Home">
              <Link href="/dashboard">
                <div className="size-8 aspect-square flex items-center justify-center">
                  <Image src="/favicon.ico" alt="Home" width={32} height={32} />
                </div>
                <div className="flex flex-col gap-0.5 leading-none">
                  <span className="font-semibold">denizlg24</span>
                  <span className="text-xs text-muted-foreground">Home</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {GROUPS.map((group) => (
          <SidebarGroup className="py-0!" key={group.groupLabel}>
            <SidebarGroupLabel>{group.groupLabel}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) =>
                  item.children ? (
                    <CollapsibleNavItem
                      key={item.label}
                      item={item}
                      pathname={pathname}
                    />
                  ) : (
                    <LeafNavItem
                      key={item.label}
                      item={item}
                      pathname={pathname}
                    />
                  ),
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}

function LeafNavItem({ item, pathname }: { item: NavItem; pathname: string }) {
  const isActive = pathname === item.href;
  const Icon = item.icon;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.label}>
        <Link href={DASHBOARD_PREFIX + item.href}>
          <Icon />
          <span className="flex-1">{item.label}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function CollapsibleNavItem({
  item,
  pathname,
}: {
  item: NavItem;
  pathname: string;
}) {
  const Icon = item.icon;
  const isChildActive = item.children?.some((c) => pathname === c.href);

  return (
    <Collapsible
      asChild
      defaultOpen={isChildActive}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.label} isActive={!!isChildActive}>
            <Icon />
            <span>{item.label}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {item.children?.map((child) => {
              const isActive = pathname === child.href;
              const ChildIcon = child.icon;

              return (
                <SidebarMenuSubItem key={child.label}>
                  <SidebarMenuSubButton asChild isActive={isActive}>
                    <Link href={DASHBOARD_PREFIX + child.href}>
                      <ChildIcon />
                      <span className="flex-1">{child.label}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
