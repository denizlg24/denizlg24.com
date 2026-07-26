import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "search",
  description: "search files and folders by name",
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
