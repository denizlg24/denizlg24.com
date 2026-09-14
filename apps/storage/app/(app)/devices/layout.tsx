import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Devices" };

export default function DevicesLayout({ children }: { children: ReactNode }) {
  return children;
}
