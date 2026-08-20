import type { FoodLoggingSummary } from "@/lib/food-logging/activity";
import type { WeightSummary } from "@/lib/weights/contracts";
import { MetricTile } from "./metric-tile";

type Props = {
  foodLoggingSummary: FoodLoggingSummary;
  weightSummary: WeightSummary;
  habits: Array<{
    id: string;
    name: string;
    targetPerWeek: number;
    completedDates: string[];
  }>;
  today: string;
};

export function HabitsSection({
  foodLoggingSummary,
  weightSummary,
  habits,
  today,
}: Props) {
  const trackedSet = new Set(weightSummary.trackedLast30Days);

  return (
    <section className="mt-7 px-5">
      <h2 className="mb-4 text-xl font-bold">Habits</h2>
      <div className="grid grid-cols-2 gap-3">
        {habits.slice(0, 2).map((habit) => (
          <MetricTile
            key={habit.id}
            href="/app/body"
            title={habit.name}
            subtitle={`${habit.targetPerWeek}× weekly target`}
            footer={
              habit.completedDates.includes(today)
                ? "Done today"
                : "Not done today"
            }
          >
            <div className="grid grid-cols-10 gap-1 py-2" aria-hidden="true">
              {weightSummary.last30Days.map((date) => (
                <span
                  key={date}
                  className={`aspect-square ${habit.completedDates.includes(date) ? "bg-primary" : "bg-muted-foreground/15"}`}
                />
              ))}
            </div>
          </MetricTile>
        ))}
        <MetricTile
          href="/app/weigh-in"
          title="Weigh-In"
          subtitle="Last 30 Days"
          footer={
            <>
              {weightSummary.weighInsThisWeek}/7{" "}
              <span className="text-xs font-medium text-muted-foreground">
                this week
              </span>
            </>
          }
        >
          <div className="grid grid-cols-10 gap-1 py-2" aria-hidden="true">
            {weightSummary.last30Days.map((date) => (
              <span
                key={date}
                className={`aspect-square ${
                  trackedSet.has(date) ? "bg-primary" : "bg-muted-foreground/15"
                }`}
              />
            ))}
          </div>
        </MetricTile>

        <MetricTile
          href="/app/food-log/activity"
          title="Food Logging"
          subtitle="Last 30 Days"
          footer={
            <>
              {foodLoggingSummary.fullThisWeek}/7{" "}
              <span className="text-xs font-medium text-muted-foreground">
                this week
              </span>
            </>
          }
        >
          <div className="grid grid-cols-10 gap-1 py-2" aria-hidden="true">
            {foodLoggingSummary.last30Days.map((day) => (
              <span
                key={day.date}
                className={`aspect-square ${
                  day.status === "full"
                    ? "bg-primary"
                    : day.status === "partial"
                      ? "border border-dashed border-primary bg-primary/15"
                      : "bg-muted-foreground/15"
                }`}
              />
            ))}
          </div>
        </MetricTile>
      </div>
    </section>
  );
}
