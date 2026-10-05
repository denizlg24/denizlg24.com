import { cn } from "@repo/ui/utils";
import Link from "next/link";
import { InView } from "@/app/_landing/in-view";
import { Phone } from "@/app/_landing/phone/phone";
import { StrategyScreen } from "@/app/_landing/screens/strategy-screen";
import {
  type Detail,
  FeatureRow,
  type SectionLink,
  sectionLead,
  sectionTitle,
} from "@/app/_landing/sections/feature-row";
import { container, SectionLabel } from "@/app/_landing/site";

const accents = [
  "bg-macro-calories",
  "bg-macro-protein",
  "bg-macro-carbs",
  "bg-macro-fat",
] as const;

/** A row of short numbered statements, each opened by a macro hue. */
export function AccentList({
  items,
  numbered = false,
  label,
}: {
  items: ReadonlyArray<{ title: string; text: string }>;
  numbered?: boolean;
  label: string;
}) {
  const List = numbered ? "ol" : "ul";
  return (
    <List
      aria-label={label}
      className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-4"
    >
      {items.map((item, index) => (
        <li key={item.title} className="reveal relative border-t pt-6 pb-10">
          <span
            aria-hidden="true"
            className={cn(
              "absolute -top-px left-0 h-0.5 w-10",
              accents[index % accents.length],
            )}
          />
          {numbered ? (
            <span className="font-figure text-sm text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
          ) : null}
          <h3
            className={cn(
              "text-xl font-semibold tracking-tight",
              numbered && "mt-3",
            )}
          >
            {item.title}
          </h3>
          <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground text-pretty">
            {item.text}
          </p>
        </li>
      ))}
    </List>
  );
}

const STEPS = [
  {
    title: "Log what you eat",
    text: "Every fully logged day sharpens the estimate. Rough days still count, just for less.",
  },
  {
    title: "Weigh in",
    text: "Daily is best, but gaps are fine. The trend carries on through them.",
  },
  {
    title: "Macros does the maths",
    text: "Your intake and your trend give an estimate of what you burn, and a range that narrows as data comes in.",
  },
  {
    title: "Check in weekly",
    text: "On the day you choose, review the week and set the targets for the next one.",
  },
] as const;

export function CoachSteps() {
  return (
    <section aria-label="How it works" className="pt-6 pb-8 sm:pt-10">
      <div className={container}>
        <AccentList items={STEPS} numbered label="How the coach works" />
      </div>
    </section>
  );
}

const CHECK_IN_DETAILS: ReadonlyArray<Detail> = [
  [
    "Your call",
    "Take the proposal as it is, or set custom targets that last until the next check-in.",
  ],
  [
    "Guard rails",
    "Calories never drop below the program’s floor or climb past 20% above what you burn.",
  ],
  [
    "High days",
    "More calories on the days you train. The other days give it back, so the week still adds up.",
  ],
  [
    "A full history",
    "Every change to your targets is kept, with the reason it happened.",
  ],
];

const OVERVIEW_DETAILS: ReadonlyArray<Detail> = [
  [
    "Weekly check-ins",
    "Review the week, then take next week’s targets — or set your own.",
  ],
  [
    "Coached or manual",
    "Let Macros propose your calories, or set them yourself.",
  ],
  ["High days", "Save extra calories for training days or weekends."],
  [
    "Honest about activity",
    "Steps are never added on top, so there’s nothing to eat back.",
  ],
];

const CHECK_IN_COPY = {
  overview: {
    title: "Targets that learn how you burn.",
    lead: "Most apps guess your calories once and never look back. Macros learns from what you eat and what you weigh, and every week it proposes calories and macros that keep you moving toward your goal.",
    details: OVERVIEW_DETAILS,
  },
  detail: {
    title: "One check-in a week.",
    lead: "On the weekday you pick, Macros sums up your last seven days — expenditure, average intake, trend weight — and proposes the coming week’s calories and macros. Nothing changes until you check in.",
    details: CHECK_IN_DETAILS,
  },
} as const;

export function CheckInFeature({
  index,
  more,
  variant,
}: {
  index?: string;
  more?: SectionLink;
  variant: keyof typeof CHECK_IN_COPY;
}) {
  const copy = CHECK_IN_COPY[variant];
  return (
    <FeatureRow
      id="check-in"
      index={index}
      label={variant === "overview" ? "Targets" : "Check-in"}
      reverse
      title={copy.title}
      lead={<p>{copy.lead}</p>}
      details={copy.details}
      more={more}
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

const PROGRAM: ReadonlyArray<Detail> = [
  [
    "Coached",
    "Each check-in proposes calories from what you burn and your goal.",
  ],
  ["Manual", "You set the calories; the macros follow your preferences."],
  [
    "Lose, gain or maintain",
    "Lose or gain at a weekly rate you choose, or hold steady.",
  ],
  ["Phases", "Cut, maintain, bulk, or take a diet break."],
  [
    "Protein and fat",
    "Protein by body weight, a fat target, and carbs fill whatever is left.",
  ],
  [
    "Goals",
    "A goal weight, with a deadline if you want one, drawn on your trend.",
  ],
];

export function ProgramFeature({ index }: { index?: string }) {
  return (
    <section
      id="program"
      aria-labelledby="program-title"
      className="py-20 sm:py-28"
    >
      <div className={container}>
        <SectionLabel index={index}>Program</SectionLabel>
        <div className="mt-12 grid gap-12 lg:mt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
          <div className="reveal">
            <h2 id="program-title" className={sectionTitle}>
              A plan for the phase you’re in.
            </h2>
            <p className={cn(sectionLead, "mt-5 max-w-md")}>
              Pick a goal and a pace, decide how protein and fat are set, and
              Macros builds every week’s targets around them.
            </p>
          </div>
          <dl className="grid gap-x-10 sm:grid-cols-2">
            {PROGRAM.map(([term, description]) => (
              <div key={term} className="reveal border-t py-5">
                <dt className="text-[15px] font-semibold">{term}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-muted-foreground">
                  {description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <p className="reveal mt-16 max-w-2xl border-t pt-6 text-[15px] leading-relaxed text-muted-foreground">
          Every figure Macros shows is an estimate to guide you, not medical
          advice.{" "}
          <Link
            href="/terms"
            className="font-medium text-foreground underline decoration-border underline-offset-4 transition-colors hover:decoration-foreground"
          >
            Read the terms
          </Link>
        </p>
      </div>
    </section>
  );
}
