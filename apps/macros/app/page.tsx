import type { Metadata } from "next";
import { ClosingCta, ComingSoon } from "@/app/_landing/sections/coming-soon";
import { Features } from "@/app/_landing/sections/features";
import { Hero } from "@/app/_landing/sections/hero";
import { SiteFooter, SiteHeader } from "@/app/_landing/site";
import { pageMetadata } from "@/app/metadata";

export const metadata: Metadata = {
  ...pageMetadata(
    "Macros — nutrition tracking for iPhone and Android",
    undefined,
    "/",
  ),
  title: { absolute: "Macros — nutrition tracking for iPhone and Android" },
};

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main id="main">
        <Hero />
        <Features />
        <ComingSoon />
        <ClosingCta />
      </main>
      <SiteFooter />
    </>
  );
}
