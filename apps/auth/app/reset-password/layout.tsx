import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "reset password" };

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
