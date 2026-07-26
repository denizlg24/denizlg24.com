import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "terminal",
  description: "a shell on the pi",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
