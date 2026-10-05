import type { ReactNode } from "react";
import { SiteFooter } from "@/app/_landing/site";
import { SiteHeader } from "@/app/_landing/site-header";

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
    </>
  );
}
