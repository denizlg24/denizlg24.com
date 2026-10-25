import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "connect a device" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
