import type { Metadata } from "next";
import { AtAGlance } from "@/app/_landing/sections/at-a-glance";
import { CheckInFeature } from "@/app/_landing/sections/coach";
import { FeatureIndex, LoggingTeaser } from "@/app/_landing/sections/features";
import { ClosingCta } from "@/app/_landing/sections/get-macros";
import { Hero } from "@/app/_landing/sections/hero";
import { WeightTrendFeature } from "@/app/_landing/sections/weight-trend";
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
      <Hero />
      <AtAGlance />
      <LoggingTeaser
        index="01"
        more={{ href: "/features", label: "Everything about logging" }}
      />
      <WeightTrendFeature
        index="02"
        more={{ href: "/coach", label: "How the coach works" }}
      />
      <CheckInFeature
        variant="overview"
        index="03"
        more={{ href: "/coach#check-in", label: "Inside the weekly check-in" }}
      />
      <FeatureIndex index="04" />
      {/* `/#get-macros` was where the download section lived; old links land here. */}
      <ClosingCta id="get-macros" />
    </>
  );
}
