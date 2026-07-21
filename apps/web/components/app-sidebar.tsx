"use client";

import {
  BookOpen,
  Brain,
  BrainCircuit,
  Briefcase,
  Calendar,
  CalendarDays,
  Clock,
  Contact,
  DollarSign,
  FileText,
  FileUser,
  FolderGit2,
  GraduationCap,
  Home,
  Inbox,
  KeyRound,
  MessageSquare,
  NotebookPen,
  Server,
  Settings,
} from "lucide-react";
import Link from "next/link";
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
    title: "Courses",
    url: "/admin/dashboard/courses",
    icon: GraduationCap,
  },
  {
    title: "Blog",
    url: "/admin/dashboard/blogs",
    icon: NotebookPen,
  },
  {
    title: "Notes",
    url: "/admin/dashboard/notes",
    icon: FileText,
  },
  {
    title: "Papers",
    url: "/admin/dashboard/papers",
    icon: BookOpen,
  },
  {
    title: "Comments",
    url: "/admin/dashboard/blogs/comments",
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
    title: "CV",
    url: "/admin/dashboard/cv",
    icon: FileUser,
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
    title: "Agent Memory",
    url: "/admin/dashboard/agent-memory",
    icon: BrainCircuit,
  },
  {
    title: "Agent Training",
    url: "/admin/dashboard/agent-training",
    icon: Brain,
  },
  {
    title: "Token Usage",
    url: "/admin/dashboard/llm-usage",
    icon: DollarSign,
  },
];

export function AppSidebar() {
  const { setOpenMobile } = useSidebar();

  return (
    <Sidebar className="z-60!">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Welcome, Deniz!</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <Link href={item.url} onClick={() => setOpenMobile(false)}>
                      <item.icon />
                      <span>{item.title}</span>
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
