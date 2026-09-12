"use client";

import { LogOut } from "lucide-react";
import { SidebarMenuButton } from "./ui/sidebar";

export const SignOutButton = () => {
  return (
    <form action="/auth/logout" method="post">
      <SidebarMenuButton type="submit">
        <LogOut />
        <span>Logout</span>
      </SidebarMenuButton>
    </form>
  );
};
