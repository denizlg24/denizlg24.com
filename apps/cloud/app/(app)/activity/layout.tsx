import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "activity",
  description: "request log, audit trail and notification history",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
