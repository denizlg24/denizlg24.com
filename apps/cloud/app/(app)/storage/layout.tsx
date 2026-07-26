import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "storage",
  description: "capacity, growth, tier split and S3 buckets",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
