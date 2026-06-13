"use client";

import {
  Brain,
  Briefcase,
  Calendar,
  CalendarDays,
  Clock,
  Contact,
  FolderGit2,
  Home,
  Inbox,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  NotebookPen,
  Server,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { FaInstagram } from "react-icons/fa6";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { SignOutButton } from "./sign-out-button";

const items = [
  {
    title: "Home",
    url: "/admin/dashboard",
    icon: Home,
  },
  {
    title: "Inbox",
    url: "/admin/dashboard/inbox",
    icon: Inbox,
  },
  {
    title: "Contacts",
    url: "/admin/dashboard/contacts",
    icon: Contact,
  },
  {
    title: "Calendar",
    url: "/admin/dashboard/calendar",
    icon: Calendar,
  },
  {
    title: "Timetable",
    url: "/admin/dashboard/timetable",
    icon: CalendarDays,
  },
  {
    title: "Blog",
    url: "/admin/dashboard/blogs",
    icon: NotebookPen,
  },
  {
    title: "Comments",
    url: "/admin/dashboard/comments",
    icon: MessageSquare,
  },
  {
    title: "Timeline",
    url: "/admin/dashboard/timeline",
    icon: Briefcase,
  },
  {
    title: "Projects",
    url: "/admin/dashboard/projects",
    icon: FolderGit2,
  },
  {
    title: "Now Page",
    url: "/admin/dashboard/now-page",
    icon: Clock,
  },
  {
    title: "Instagram Tokens",
    url: "/admin/dashboard/instagram-tokens",
    icon: FaInstagram,
  },
  {
    title: "API Tokens",
    url: "/admin/dashboard/api-tokens",
    icon: Settings,
  },
  {
    title: "Authenticator",
    url: "/admin/dashboard/authenticator",
    icon: KeyRound,
  },
  {
    title: "Resources",
    url: "/admin/dashboard/resources",
    icon: Server,
  },
  {
    title: "LLM Usage",
    url: "/admin/dashboard/llm-usage",
    icon: Brain,
  },
];

export function AppSidebar() {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <Sidebar className="z-60!">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Welcome, Deniz!</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      item.url === "/admin/dashboard"
                        ? pathname === item.url
                        : pathname.startsWith(item.url)
                    }
                  >
                    <Link
                      href={item.url}
                      aria-busy={pendingHref === item.url}
                      onClick={(event) => {
                        if (
                          pathname !== item.url &&
                          event.button === 0 &&
                          !event.metaKey &&
                          !event.ctrlKey &&
                          !event.shiftKey &&
                          !event.altKey
                        ) {
                          setPendingHref(item.url);
                        }
                        setOpenMobile(false);
                      }}
                    >
                      <item.icon />
                      <span>{item.title}</span>
                      {pendingHref === item.url && (
                        <LoaderCircle className="ml-auto animate-spin" />
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
              <SidebarMenuItem key={"logout"}>
                <SignOutButton />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
