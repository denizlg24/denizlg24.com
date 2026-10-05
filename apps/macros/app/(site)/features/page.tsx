import { BodyAndHabits } from "@/app/_landing/sections/body-habits";
import {
  AddFoodFeature,
  EverythingElse,
  LoggingFeature,
  NoTrackers,
  NutrientsFeature,
  RecipesFeature,
  ScanningFeature,
} from "@/app/_landing/sections/features";
import { ClosingCta } from "@/app/_landing/sections/get-macros";
import { OnThisPage, PageIntro } from "@/app/_landing/sections/page-intro";
import { pageMetadata } from "@/app/metadata";

export const metadata = pageMetadata(
  "Features",
  "An hour-by-hour food log, barcode and label scanning, recipes, a plate for whole meals, 50+ nutrients, habits, water, measurements and progress photos.",
  "/features",
);

const SECTIONS = [
  { href: "#logging", label: "Logging" },
  { href: "#add-food", label: "Add food" },
  { href: "#scanning", label: "Scanning" },
  { href: "#recipes", label: "Recipes" },
  { href: "#nutrients", label: "Nutrients" },
  { href: "#body", label: "Body and habits" },
  { href: "#more", label: "Everything else" },
] as const;

export default function FeaturesPage() {
  return (
    <>
      <PageIntro
        eyebrow="Features"
        title={
          <>
            <span className="block">Fast to log.</span>
            <span className="block text-muted-foreground">
              Deep when you want it.
            </span>
          </>
        }
        lead={
          <p>
            Search, scan or photograph a label, and the food lands at the time
            you ate it. Then go as far into the numbers as you like — down to
            the amino acids.
          </p>
        }
      >
        <OnThisPage items={SECTIONS} />
      </PageIntro>
      <LoggingFeature index="01" />
      <AddFoodFeature index="02" />
      <ScanningFeature index="03" />
      <RecipesFeature index="04" />
      <NutrientsFeature index="05" />
      <BodyAndHabits index="06" />
      <EverythingElse index="07" />
      <NoTrackers />
      <ClosingCta />
    </>
  );
}
