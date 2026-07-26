import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "disks",
  description: "ssd and hdd usage, health and tiering",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
