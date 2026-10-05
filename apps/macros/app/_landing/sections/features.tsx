import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { InView } from "@/app/_landing/in-view";
import { IosTabBar } from "@/app/_landing/phone/ios";
import { Phone } from "@/app/_landing/phone/phone";
import { AddFoodScreen } from "@/app/_landing/screens/add-food-screen";
import { LogScreen } from "@/app/_landing/screens/log-screen";
import {
  type Detail,
  FeatureRow,
  type SectionLink,
  sectionLead,
  sectionTitle,
} from "@/app/_landing/sections/feature-row";
import { LabelScanFigure } from "@/app/_landing/sections/label-scan";
import { NutrientFigure } from "@/app/_landing/sections/nutrient-figure";
import { RecipeFigure } from "@/app/_landing/sections/recipe-figure";
import { container, MoreLink, SectionLabel } from "@/app/_landing/site";

const addFoodPhoneLabel =
  "The Macros Add food screen: logging at the current time, foods suggested for this time of day with the first one just logged, plus saved meals and recipes.";

export function LoggingFeature({ index }: { index?: string }) {
  return (
    <FeatureRow
      id="logging"
      index={index}
      label="Logging"
      title="Your day, hour by hour."
      lead={
        <p>
          There are no breakfast, lunch and dinner boxes to sort food into.
          Every entry lands at the time you ate it, so the log reads the way
          your day went.
        </p>
      }
      details={[
        [
          "Copy and move",
          "Repeat yesterday’s breakfast, or move an entry to another day.",
        ],
        [
          "Drag to retime",
          "Ate it earlier than you logged it? Drag it to the right time.",
        ],
        [
          "Quick add",
          "Just calories and macros, for when there’s nothing to search for.",
        ],
        [
          "Day notes",
          "A line of context: a dinner out, a long run, a rough night.",
        ],
        ["The week above", "A calorie ring for every day, right over the log."],
        [
          "Works offline",
          "No signal at the gym? Keep logging — it syncs when you’re back.",
        ],
      ]}
      visual={
        <InView>
          <Phone label="The Macros food log: a week of calorie rings, the day’s totals, and the day hour by hour, with each food’s calories and macros.">
            <LogScreen />
            <IosTabBar active="log" />
          </Phone>
        </InView>
      }
    />
  );
}

export function AddFoodFeature({ index }: { index?: string }) {
  return (
    <FeatureRow
      id="add-food"
      index={index}
      label="Add food"
      reverse
      title="One place to add anything."
      lead={
        <p>
          Search, saved meals, recipes, your own foods and your shopping list
          share one screen — and the foods you usually eat around this time are
          already at the top.
        </p>
      }
      details={[
        [
          "The plate",
          "Tap + on anything to put it on the plate, then log the whole meal at once.",
        ],
        ["Save the plate", "A plate you make often becomes a recipe."],
        [
          "Saved meals",
          "Save a meal from your log and add it again in one tap.",
        ],
        [
          "Your own foods",
          "Add what’s missing. A label photo fills most of it in.",
        ],
        [
          "Shopping list",
          "Plan what to buy, tick it off in the shop, log from it later.",
        ],
        [
          "Any day, any time",
          "Logging something from earlier? Set when you ate it first.",
        ],
      ]}
      visual={
        <InView>
          <Phone label={addFoodPhoneLabel}>
            <AddFoodScreen />
          </Phone>
        </InView>
      }
    />
  );
}

export function ScanningFeature({ index }: { index?: string }) {
  return (
    <FeatureRow
      id="scanning"
      index={index}
      label="Scanning"
      title="Barcodes and labels, read for you."
      lead={
        <p>
          Scan a barcode to find the packet. If it isn’t in the catalogue yet,
          photograph the nutrition label and Macros reads the numbers off it —
          you check them, then save.
        </p>
      }
      details={[
        [
          "Barcode scanning",
          "Point the camera at a packet. There’s a torch for dim kitchens.",
        ],
        [
          "Label photos",
          "Flat, well lit and in focus is all it takes. Or pick a photo you already have.",
        ],
        [
          "A big catalogue",
          "Common foods and branded products, from USDA data, national food tables and Open Food Facts.",
        ],
        [
          "History that holds",
          "A logged food keeps the nutrition it had that day, even if the catalogue changes later.",
        ],
      ]}
      visual={<LabelScanFigure />}
    />
  );
}

export function RecipesFeature({ index }: { index?: string }) {
  return (
    <FeatureRow
      id="recipes"
      index={index}
      label="Recipes"
      reverse
      title={
        <>
          <span className="block">Cook once.</span>
          <span className="block">Log it by the serving.</span>
        </>
      }
      lead={
        <p>
          Add the ingredients and how many servings the pot makes, and Macros
          does the division — for every nutrient, not just calories. Weigh the
          finished dish and you can log it by the gram, too.
        </p>
      }
      details={[
        ["By the serving", "Half a bowl or two: log what you actually had."],
        ["By the gram", "Enter the cooked weight once and weigh your portion."],
        ["From the plate", "Built a meal on the plate? Save it as a recipe."],
        ["Swipe to log", "Swipe a recipe in the list to log a serving."],
      ]}
      visual={<RecipeFigure />}
    />
  );
}

export function NutrientsFeature({ index }: { index?: string }) {
  return (
    <FeatureRow
      id="nutrients"
      index={index}
      label="Nutrients"
      title="More than calories and macros."
      lead={
        <p>
          Over 50 nutrients — fiber and fats, 12 vitamins, 10 minerals and the
          essential amino acids — measured against reference intakes for your
          sex and age. Limits like sodium count toward a ceiling instead of a
          goal.
        </p>
      }
      details={[
        [
          "Targets and limits",
          "Floors to reach, like fiber and iron. Ceilings to stay under, like sodium.",
        ],
        [
          "Upper limits",
          "A warning when a vitamin or mineral passes its safe upper limit.",
        ],
        [
          "Every food’s panel",
          "Open any food to see its full nutrition, not just the label basics.",
        ],
        [
          "Shortfalls",
          "Statistics show which nutrients you keep coming up short on.",
        ],
      ]}
      visual={<NutrientFigure />}
    />
  );
}

const EVERYTHING_ELSE: ReadonlyArray<Detail> = [
  [
    "Statistics",
    "Intake, adherence, macro split, time of day, top foods and shortfalls, over any period.",
  ],
  ["Export", "Download your statistics as CSV or JSON whenever you like."],
  [
    "Apple Health",
    "On iPhone, weight, steps and active energy come in, and what you eat goes out.",
  ],
  [
    "Reminders",
    "Nudges to log food, weigh in and tick off habits, at the times you pick.",
  ],
  [
    "Quick actions",
    "On iPhone, press and hold the app icon to search, scan, quick add or weigh in.",
  ],
  ["Streaks", "A year of logging at a glance, to keep you going."],
  ["Your units", "Calories or kilojoules, kilograms or pounds."],
  ["Dark mode", "Follows your phone’s light or dark setting."],
];

export function EverythingElse({ index }: { index?: string }) {
  return (
    <section id="more" aria-labelledby="more-title" className="py-20 sm:py-28">
      <div className={container}>
        <SectionLabel index={index}>Everything else</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="reveal">
            <h2 id="more-title" className={sectionTitle}>
              All of it, included.
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

export function NoTrackers() {
  return (
    <section aria-labelledby="privacy-title" className="border-t">
      <div
        className={cn(
          container,
          "grid gap-8 py-20 sm:py-28 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20",
        )}
      >
        <h2 id="privacy-title" className={cn(sectionTitle, "reveal max-w-md")}>
          No ads. No trackers.
        </h2>
        <div className="reveal flex max-w-xl flex-col gap-6">
          <p className={sectionLead}>
            What you eat is your business. Macros has no advertising and no
            third-party analytics, and your progress photos stay private — only
            you can see them.
          </p>
          <MoreLink href="/privacy">Read the privacy policy</MoreLink>
        </div>
      </div>
    </section>
  );
}

/** The overview's first chapter: logging, told short. */
export function LoggingTeaser({
  index,
  more,
}: {
  index?: string;
  more: SectionLink;
}) {
  return (
    <FeatureRow
      id="logging"
      index={index}
      label="Logging"
      title="Log a meal in seconds."
      lead={
        <p>
          Search common and branded foods, scan a barcode, or photograph a
          nutrition label. What you usually eat at this hour is already waiting
          at the top.
        </p>
      }
      details={[
        [
          "Barcodes and labels",
          "Point the camera at a packet, or at its nutrition table.",
        ],
        ["The plate", "Pile up a whole meal, then log it all at once."],
        [
          "Recipes and saved meals",
          "Build a dish once and log it by the serving.",
        ],
        [
          "Works offline",
          "No signal? Keep logging — it syncs when you’re back.",
        ],
      ]}
      more={more}
      visual={
        <InView>
          <Phone label={addFoodPhoneLabel}>
            <AddFoodScreen />
          </Phone>
        </InView>
      }
    />
  );
}

const FEATURE_INDEX: ReadonlyArray<SectionLink> = [
  { href: "/features#logging", label: "Hour-by-hour log" },
  { href: "/features#scanning", label: "Barcode scanning" },
  { href: "/features#scanning", label: "Label photos" },
  { href: "/features#add-food", label: "The plate" },
  { href: "/features#recipes", label: "Recipes" },
  { href: "/features#add-food", label: "Saved meals" },
  { href: "/features#add-food", label: "Shopping list" },
  { href: "/features#nutrients", label: "50+ nutrients" },
  { href: "/features#body", label: "Habits" },
  { href: "/features#body", label: "Water" },
  { href: "/features#body", label: "Measurements" },
  { href: "/features#body", label: "Progress photos" },
  { href: "/features#more", label: "Statistics" },
  { href: "/features#more", label: "Apple Health" },
  { href: "/features#more", label: "Reminders" },
  { href: "/features#more", label: "Export" },
];

/** Every feature by name, each one a way into the features page. */
export function FeatureIndex({ index }: { index?: string }) {
  return (
    <section aria-labelledby="index-title" className="py-20 sm:py-28">
      <div className={container}>
        <SectionLabel index={index}>And the rest</SectionLabel>
        <div className="mt-12 grid gap-10 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="reveal">
            <h2 id="index-title" className={sectionTitle}>
              Everything, included.
            </h2>
            <p className={cn(sectionLead, "mt-5 max-w-md")}>
              No premium tier and no paywall. Every feature is free, for
              everyone.
            </p>
            <MoreLink href="/features" className="mt-8">
              See every feature
            </MoreLink>
          </div>
          <ul className="reveal flex flex-wrap gap-x-1 gap-y-1.5 text-[clamp(1.35rem,3.4vw,2rem)] leading-tight font-semibold tracking-[-0.03em]">
            {FEATURE_INDEX.map((item, position) => (
              <li key={item.label} className="flex items-baseline">
                <Link
                  href={item.href}
                  className="rounded-sm text-muted-foreground transition-colors hover:text-foreground"
                >
                  {item.label}
                </Link>
                {position < FEATURE_INDEX.length - 1 ? (
                  <span
                    aria-hidden="true"
                    className="pl-1 text-muted-foreground/40"
                  >
                    /
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
