import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Shared links" };

export default function SharesLayout({ children }: { children: ReactNode }) {
  return children;
}
