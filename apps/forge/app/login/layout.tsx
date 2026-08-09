import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "sign in",
  description: "sign in to deniz forge",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
