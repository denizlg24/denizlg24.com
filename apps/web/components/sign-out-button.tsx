"use client";

import { LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { SidebarMenuButton } from "./ui/sidebar";

export const SignOutButton = () => {
  const router = useRouter();
  return (
    <SidebarMenuButton asChild>
      <a
        href="#"
        onClick={async (e) => {
          e.preventDefault();
          await authClient.signOut({
            fetchOptions: {
              onSuccess: () => {
                router.push("/auth/login");
              },
            },
          });
        }}
      >
        <LogOut />
        <span>Logout</span>
      </a>
    </SidebarMenuButton>
  );
};
