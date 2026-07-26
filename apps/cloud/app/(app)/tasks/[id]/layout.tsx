import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "task",
  description: "task schedule, config and run history",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
