import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "users",
  description: "accounts, roles and api keys",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
