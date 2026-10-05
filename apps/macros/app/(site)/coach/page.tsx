import {
  CheckInFeature,
  CoachSteps,
  ProgramFeature,
} from "@/app/_landing/sections/coach";
import { ExpenditureFeature } from "@/app/_landing/sections/expenditure";
import { ClosingCta } from "@/app/_landing/sections/get-macros";
import { PageIntro } from "@/app/_landing/sections/page-intro";
import { WeightTrendFeature } from "@/app/_landing/sections/weight-trend";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "How the coach works",
  "Macros reads a weight trend through the daily noise, measures what you actually burn from your own logs and weigh-ins, and proposes new targets at a weekly check-in.",
  "/coach",
);

export default function CoachPage() {
  return (
    <>
      <PageIntro
        eyebrow="Coach"
        title={
          <>
            <span className="block">Your metabolism, measured.</span>
            <span className="block text-muted-foreground">Not guessed.</span>
          </>
        }
        lead={
          <p>
            Calculators estimate what you burn once and never look back. Macros
            compares what you eat with how your weight actually moves, works out
            what you burn, and turns it into next week’s targets.
          </p>
        }
      />
      <CoachSteps />
      <WeightTrendFeature index="01" />
      <ExpenditureFeature index="02" />
      <CheckInFeature variant="detail" index="03" />
      <ProgramFeature index="04" />
      <ClosingCta />
    </>
  );
}
