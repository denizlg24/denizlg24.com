import { cn } from "@repo/ui/utils";
import { container } from "@/app/_landing/site";

const FIGURES = [
  {
    value: "24",
    unit: "hours",
    accent: "bg-macro-calories",
    text: "in a log that runs by the clock. Food lands at the time you ate it, never in a meal slot.",
  },
  {
    value: "50+",
    unit: "nutrients",
    accent: "bg-macro-carbs",
    text: "from fiber to vitamin D, measured against daily reference intakes.",
  },
  {
    value: "7",
    unit: "days",
    accent: "bg-macro-protein",
    text: "between check-ins, on the weekday you choose. Targets move only when you do.",
  },
  {
    value: "0",
    unit: "ads",
    accent: "bg-macro-fat",
    text: "and no trackers or third-party analytics. What you eat stays your business.",
  },
] as const;

export function AtAGlance() {
  return (
    <section aria-label="Macros at a glance">
      <div className={container}>
        <ul className="grid grid-cols-2 gap-x-5 sm:gap-x-8 lg:grid-cols-4">
          {FIGURES.map((figure) => (
            <li
              key={figure.unit}
              className="reveal relative border-t pt-6 pb-10 sm:pt-7 sm:pb-12"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "absolute -top-px left-0 h-0.5 w-10",
                  figure.accent,
                )}
              />
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-figure text-[2.75rem] leading-none font-semibold tracking-[-0.03em] sm:text-[3.5rem]">
                  {figure.value}
                </span>
                <span className="text-sm font-semibold sm:text-[15px]">
                  {figure.unit}
                </span>
              </p>
              <p className="mt-4 max-w-[17rem] text-sm leading-relaxed text-muted-foreground text-pretty sm:text-[15px]">
                {figure.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
