import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "project",
  description: "project databases, storage, keys and usage",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
