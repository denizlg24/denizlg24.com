import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Shared with you",
  description: "Something shared from Deniz Cloud",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
