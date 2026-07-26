import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "shared file",
  description: "a file shared from deniz storage",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
