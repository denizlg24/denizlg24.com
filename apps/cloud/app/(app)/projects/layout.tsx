import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "projects",
  description: "provisioned projects, databases and credentials",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
