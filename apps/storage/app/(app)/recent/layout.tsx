import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Recent" };

export default function RecentLayout({ children }: { children: ReactNode }) {
  return children;
}
