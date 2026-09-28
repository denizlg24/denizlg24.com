import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { InView } from "@/app/_landing/in-view";
import { Phone } from "@/app/_landing/phone/phone";
import { AddFoodScreen } from "@/app/_landing/screens/add-food-screen";
import { StrategyScreen } from "@/app/_landing/screens/strategy-screen";
import {
  FeatureRow,
  sectionLead,
  sectionTitle,
} from "@/app/_landing/sections/feature-row";
import { WeightTrendFeature } from "@/app/_landing/sections/weight-trend";
import { container, SectionLabel } from "@/app/_landing/site";

function LoggingFeature() {
  return (
    <FeatureRow
      id="logging"
      index="01"
      label="Logging"
      title="Logging that keeps up with you."
      lead={
        <p>
          Search common and branded foods, scan a barcode, or photograph a
          nutrition label. What you usually eat around this time is already at
          the top, one tap from logged.
        </p>
      }
      details={[
        ["Barcodes", "Point the camera at a packet to find the product."],
        [
          "Nutrition labels",
          "Photograph a label and the values are read in for you to check.",
        ],
        [
          "Recipes and saved meals",
          "Log a serving of a recipe, or a saved meal, in one go.",
        ],
        ["The plate", "Gather several foods, then log them together."],
        [
          "Any day, any time",
          "Copy another day, or just part of it, and move entries to another time or day.",
        ],
        [
          "Offline",
          "Entries made without signal are kept and sent when you’re back.",
        ],
      ]}
      visual={
        <InView>
          <Phone label="The Macros Add food screen: logging at the current time, foods suggested for this time of day with the first one just logged, plus saved meals and recipes.">
            <AddFoodScreen />
          </Phone>
        </InView>
      }
    />
  );
}

function TargetsFeature() {
  return (
    <FeatureRow
      id="targets"
      index="03"
      label="Targets"
      reverse
      title="Targets that learn what you burn."
      lead={
        <p>
          Macros starts from a formula, then follows your data: it estimates
          what you burn from what you eat and what you weigh. On check-in day it
          sets next week’s calories and macros from that estimate and your goal.
        </p>
      }
      details={[
        ["Coached", "Targets update on their own at each check-in."],
        [
          "Collaborative",
          "Each check-in proposes new targets for you to accept.",
        ],
        [
          "Manual",
          "You set the calorie target; macros follow your preferences.",
        ],
        ["High days", "Put extra calories on the days you choose."],
        [
          "Activity",
          "Steps are shown as context and never added on top of your budget.",
        ],
      ]}
      visual={
        <InView>
          <Phone label="The Macros Strategy screen: new targets from the next check-in waiting to be accepted, and this week’s targets by day.">
            <StrategyScreen />
          </Phone>
        </InView>
      }
    />
  );
}

const EVERYTHING_ELSE: ReadonlyArray<readonly [string, string]> = [
  [
    "Micronutrients",
    "Vitamins and minerals for the day, measured against WHO guidelines.",
  ],
  [
    "Recipes",
    "Built from ingredients, logged by the serving, with nutrition per serving.",
  ],
  [
    "Your own foods",
    "With their own serving sizes — or started from a label photo.",
  ],
  ["Shopping list", "What to buy, ticked off as you go."],
  ["Body", "Waist, hips and other measurements, each with its own trend."],
  [
    "Progress photos",
    "Several angles per weigh-in, kept in private object storage.",
  ],
  ["Habits", "Weekly targets for the rest of your routine, ticked from Today."],
  [
    "Apple Health",
    "A Shortcut you set up sends weight, body fat, steps and active energy.",
  ],
  [
    "Streaks",
    "A year of logging as a heatmap, and streaks for food and weigh-ins.",
  ],
  ["Export", "Your statistics as CSV or JSON, whenever you want them."],
  ["Units", "kcal or kJ, kg or lb."],
  ["Light and dark", "Follows your iPhone’s appearance."],
];

function EverythingElse() {
  return (
    <section aria-labelledby="more-title" className="py-20 sm:py-24">
      <div className={container}>
        <SectionLabel index="04">More</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="reveal">
            <h2 id="more-title" className={sectionTitle}>
              The rest of the toolkit.
            </h2>
            <p className={cn(sectionLead, "mt-5 max-w-md")}>
              Tucked behind a tab or a menu, out of the way until you want it —
              and all of it free.
            </p>
          </div>
          <ul className="grid gap-x-10 sm:grid-cols-2">
            {EVERYTHING_ELSE.map(([title, description]) => (
              <li key={title} className="reveal border-t py-5">
                <h3 className="text-[15px] font-semibold">{title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                  {description}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function NoTrackers() {
  return (
    <section aria-labelledby="privacy-title" className="border-t">
      <div
        className={cn(
          container,
          "grid gap-8 py-20 sm:py-24 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20",
        )}
      >
        <h2 id="privacy-title" className={cn(sectionTitle, "reveal max-w-md")}>
          No ads. No trackers.
        </h2>
        <div className="reveal flex max-w-xl flex-col gap-5">
          <p className={sectionLead}>
            Macros has no advertising and no third-party analytics. What you log
            is stored on servers the developer runs, and progress photos sit in
            private storage, shown to you through links that expire within
            minutes.
          </p>
          <Link
            href="/privacy"
            className="w-fit text-[15px] font-semibold underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            Read the privacy policy
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Features() {
  return (
    <div id="features" className="border-t">
      <LoggingFeature />
      <WeightTrendFeature />
      <TargetsFeature />
      <EverythingElse />
      <NoTrackers />
    </div>
  );
}
