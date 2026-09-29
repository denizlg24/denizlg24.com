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
      label="Logging"
      title="Log a meal in seconds."
      lead={
        <p>
          Search common and branded foods, scan a barcode, or snap a nutrition
          label. The things you usually eat at this time of day are already
          waiting at the top.
        </p>
      }
      details={[
        ["Barcode scanning", "Point your camera at a packet and it’s found."],
        [
          "Label photos",
          "Snap a nutrition label and Macros fills in the numbers.",
        ],
        [
          "Recipes and meals",
          "Save the dishes you make and log a serving in one tap.",
        ],
        ["The plate", "Pile up a whole meal, then log it all at once."],
        [
          "Copy and move",
          "Repeat yesterday’s breakfast or shift an entry to another day.",
        ],
        [
          "Works offline",
          "No signal at the gym? Keep logging — it syncs when you’re back.",
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
      label="Targets"
      reverse
      title="Targets that learn how you burn."
      lead={
        <p>
          Most apps guess your calories once and never look back. Macros learns
          from what you eat and what you weigh, and every week it tunes your
          calories and macros to keep you moving toward your goal.
        </p>
      }
      details={[
        ["Hands-off", "Let your targets adjust themselves every week."],
        ["Your call", "Review each week’s new targets before you accept them."],
        ["Fully manual", "Prefer your own numbers? Set them and go."],
        ["High days", "Save extra calories for weekends or big days."],
        [
          "Honest about activity",
          "Steps never inflate your budget, so there’s no eating back guesses.",
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
    "Vitamins and minerals",
    "See the full picture of your day, not just calories and macros.",
  ],
  ["Recipes", "Build a dish once and log it by the serving forever."],
  [
    "Your own foods",
    "Add anything that’s missing — a label photo does most of the work.",
  ],
  ["Shopping list", "Plan the week’s food and tick it off in the shop."],
  [
    "Body measurements",
    "Track your waist, hips and more, each with its own trend.",
  ],
  [
    "Progress photos",
    "See the change you can’t read on the scale. Only you can view them.",
  ],
  ["Habits", "Water, sleep, steps — tick off the rest of your routine."],
  [
    "Apple Health",
    "On iPhone, bring in your weight, steps and activity automatically.",
  ],
  ["Streaks", "A year of logging at a glance to keep you going."],
  ["Export", "Your data is yours. Download it whenever you like."],
  ["Your units", "Calories or kilojoules, kilograms or pounds."],
  ["Dark mode", "Follows your phone’s light or dark setting."],
];

function EverythingElse() {
  return (
    <section aria-labelledby="more-title" className="py-20 sm:py-24">
      <div className={container}>
        <SectionLabel>More</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="reveal">
            <h2 id="more-title" className={sectionTitle}>
              Everything else, included.
            </h2>
            <p className={cn(sectionLead, "mt-5 max-w-md")}>
              No premium tier and no paywall. Every feature is free, for
              everyone.
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
            What you eat is your business. Macros has no advertising and no
            third-party analytics, and your progress photos stay private — only
            you can see them.
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
