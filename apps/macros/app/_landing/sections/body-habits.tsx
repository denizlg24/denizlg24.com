import { cn } from "@repo/ui/utils";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";
import { InView } from "@/app/_landing/in-view";
import { delay } from "@/app/_landing/phone/ios";
import { sectionLead, sectionTitle } from "@/app/_landing/sections/feature-row";
import { container, SectionLabel } from "@/app/_landing/site";

const WEEK = [
  { letter: "M", done: true },
  { letter: "T", done: false },
  { letter: "W", done: true },
  { letter: "T", done: false },
  { letter: "F", done: true },
  { letter: "S", done: false },
  { letter: "S", done: false },
] as const;

function HabitWeek() {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Strength training</span>
        <span className="font-figure text-muted-foreground">3 of 4</span>
      </span>
      <span className="flex justify-between">
        {WEEK.map((day, index) => (
          <span
            key={`${day.letter}-${index}`}
            className="flex flex-col items-center gap-1.5"
          >
            <span
              className={cn(
                "size-6 rounded-full",
                day.done
                  ? "a-pop bg-foreground"
                  : "shadow-[inset_0_0_0_1.5px_var(--border)]",
              )}
              style={day.done ? delay(0.2 + index * 0.08) : undefined}
            />
            <span className="text-[11px] font-medium text-muted-foreground">
              {day.letter}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

function WaterGlasses() {
  const glasses = [1, 1, 1, 1, 0.6] as const;
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Water</span>
        <span className="font-figure text-muted-foreground">1.15 L</span>
      </span>
      <span className="flex items-end gap-2">
        {glasses.map((fill, index) => (
          <span
            key={index}
            className="relative h-9 w-6 overflow-hidden rounded-b-[7px] rounded-t-[2px] shadow-[inset_0_0_0_1.5px_var(--border)]"
          >
            <span
              className="a-grow-y absolute inset-x-0 bottom-0 bg-macro-calories/80"
              style={{
                ...delay(0.2 + index * 0.12),
                height: `${fill * 100}%`,
              }}
            />
          </span>
        ))}
      </span>
    </div>
  );
}

const WAIST = [86.6, 86.4, 86.1, 85.9, 85.6, 85.3, 84.9, 84.5];

function MeasurementSpark() {
  const min = Math.min(...WAIST) - 0.3;
  const max = Math.max(...WAIST) + 0.3;
  const points = WAIST.map(
    (cm, index) =>
      `${((index / (WAIST.length - 1)) * 100).toFixed(1)},${(((max - cm) / (max - min)) * 32).toFixed(1)}`,
  ).join(" ");
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Waist</span>
        <span className="font-figure text-muted-foreground">
          84.5 cm · −2.1
        </span>
      </span>
      <div className="a-wipe h-9" style={delay(0.2)}>
        <svg
          viewBox="0 0 100 32"
          preserveAspectRatio="none"
          className="size-full overflow-visible"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

function PhotoAngles() {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Photos</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Lock className="size-3" strokeWidth={2.4} />
          Private
        </span>
      </span>
      <span className="flex gap-2">
        {["Front", "Side", "Back"].map((angle, index) => (
          <span
            key={angle}
            className="a-rise flex h-9 flex-1 items-end justify-center rounded-[6px] bg-foreground/7 pb-1 text-[10px] font-medium text-muted-foreground"
            style={delay(0.2 + index * 0.1)}
          >
            {angle}
          </span>
        ))}
      </span>
    </div>
  );
}

const ITEMS: ReadonlyArray<{
  title: string;
  text: string;
  visual: ReactNode;
}> = [
  {
    title: "Habits",
    text: "Anything you want to keep up — daily, on set weekdays, or a few times a week — with a reminder if you like.",
    visual: <HabitWeek />,
  },
  {
    title: "Water",
    text: "Pour a glass on screen and it’s logged.",
    visual: <WaterGlasses />,
  },
  {
    title: "Measurements",
    text: "Waist, hips, chest, arms, thighs, calf, neck and body fat, each with its own history.",
    visual: <MeasurementSpark />,
  },
  {
    title: "Progress photos",
    text: "Front, side and back, for the change the scale doesn’t show. Only you can see them.",
    visual: <PhotoAngles />,
  },
];

export function BodyAndHabits({ index }: { index?: string }) {
  return (
    <section id="body" aria-labelledby="body-title" className="py-20 sm:py-28">
      <div className={container}>
        <SectionLabel index={index}>Body and habits</SectionLabel>
        <div className="mt-12 grid gap-6 lg:mt-16 lg:grid-cols-2 lg:items-end lg:gap-20">
          <h2 id="body-title" className={cn(sectionTitle, "reveal max-w-xl")}>
            The rest of the routine, in the same place.
          </h2>
          <p className={cn(sectionLead, "reveal max-w-xl")}>
            Food is only part of it. Habits, water, measurements and progress
            photos live beside your log, so the whole picture is one tap away.
          </p>
        </div>
        <InView threshold={0.25}>
          <ul className="mt-14 grid gap-x-8 sm:mt-16 sm:grid-cols-2 lg:grid-cols-4">
            {ITEMS.map((item) => (
              <li key={item.title} className="reveal border-t pt-6 pb-10">
                <div aria-hidden="true">{item.visual}</div>
                <h3 className="mt-6 text-[15px] font-semibold">{item.title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground text-pretty">
                  {item.text}
                </p>
              </li>
            ))}
          </ul>
        </InView>
      </div>
    </section>
  );
}
