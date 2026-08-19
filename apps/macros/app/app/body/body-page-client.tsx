"use client";

import { Button } from "@repo/ui/button";
import { Input } from "@repo/ui/input";
import { NumericField } from "@repo/ui/numeric-field";
import { SegmentedControl } from "@repo/ui/segmented-control";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, Check, Droplets, Link2, Plus, Ruler } from "lucide-react";
import { useMemo, useState } from "react";
import { PageHeader } from "../_components/page-header";
import { ProgressPhotos } from "./progress-photos";

type MeasurementSite =
  | "waist"
  | "hips"
  | "chest"
  | "neck"
  | "left_arm"
  | "right_arm"
  | "left_thigh"
  | "right_thigh"
  | "calf"
  | "body_fat";
type BodyOverview = {
  today: string;
  measurements: Array<{
    id: string;
    logDate: string;
    site: MeasurementSite;
    value: number;
    unit: string;
  }>;
  activity: Array<{
    logDate: string;
    steps: number | null;
    activeEnergyKcal: number | null;
  }>;
  hydration: Array<{ logDate: string; volumeMl: number }>;
  habits: Array<{
    id: string;
    name: string;
    targetPerWeek: number;
    completedDates: string[];
  }>;
};

const sites = [
  { value: "waist", label: "Waist" },
  { value: "hips", label: "Hips" },
  { value: "chest", label: "Chest" },
] satisfies Array<{ value: MeasurementSite; label: string }>;

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json() as Promise<T>;
}

export function BodyPageClient() {
  const queryClient = useQueryClient();
  const [site, setSite] = useState<MeasurementSite>("waist");
  const [measurement, setMeasurement] = useState("");
  const [steps, setSteps] = useState("");
  const [habitName, setHabitName] = useState("");
  const [habitWindow, setHabitWindow] = useState<"30" | "90">("30");
  const [importToken, setImportToken] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["body-overview"],
    queryFn: async () =>
      (await requestJson<{ overview: BodyOverview }>("/api/body/overview"))
        .overview,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["body-overview"] });
  const mutation = useMutation({
    mutationFn: ({
      url,
      body,
      method = "POST",
    }: {
      url: string;
      body: unknown;
      method?: string;
    }) => requestJson(url, { method, body: JSON.stringify(body) }),
    onSuccess: refresh,
  });
  const today = query.data?.today ?? new Date().toISOString().slice(0, 10);
  const todayHydration =
    query.data?.hydration.find((item) => item.logDate === today)?.volumeMl ?? 0;
  const latestBySite = useMemo(() => {
    const map = new Map<
      MeasurementSite,
      BodyOverview["measurements"][number]
    >();
    for (const item of query.data?.measurements ?? []) map.set(item.site, item);
    return map;
  }, [query.data?.measurements]);

  return (
    <div className="min-h-dvh pb-36">
      <PageHeader title="Body & habits" backLabel="Back" />
      <div className="space-y-8 px-5 pt-5">
        <ProgressPhotos />
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Ruler className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Measurements</h2>
          </div>
          <SegmentedControl
            ariaLabel="Measurement site"
            value={site}
            options={sites}
            onValueChange={setSite}
          />
          <MeasurementTrend
            points={(query.data?.measurements ?? []).filter(
              (item) => item.site === site,
            )}
          />
          <div className="flex gap-2">
            <NumericField
              aria-label={`${site} measurement in centimetres`}
              value={measurement}
              placeholder={
                latestBySite.get(site)
                  ? `${latestBySite.get(site)?.value} cm last`
                  : "cm"
              }
              onValueChange={setMeasurement}
            />
            <Button
              disabled={!Number(measurement) || mutation.isPending}
              onClick={() => {
                mutation.mutate({
                  url: "/api/body/measurements",
                  body: {
                    logDate: today,
                    site,
                    value: Number(measurement),
                    unit: "cm",
                  },
                });
                setMeasurement("");
              }}
            >
              Save
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Health import</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            A PWA cannot read Apple Health directly. Create a one-time-visible
            bearer token, then have an Apple Shortcut POST weight and step
            records to <code>/api/health-import/webhook</code>. Imported records
            are idempotent by date and never replace a manual weigh-in.
          </p>
          {importToken ? (
            <div className="rounded-xl bg-muted p-3">
              <p className="mb-1 text-xs font-semibold">Copy this token now</p>
              <code className="break-all text-xs">{importToken}</code>
            </div>
          ) : (
            <Button
              variant="outline"
              onClick={async () => {
                const response = await requestJson<{
                  token: { token: string };
                }>("/api/health-import/tokens", {
                  method: "POST",
                  body: JSON.stringify({
                    source: "apple_shortcuts",
                    label: "Apple Health Shortcut",
                  }),
                });
                setImportToken(response.token.token);
              }}
            >
              Create Shortcut token
            </Button>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Steps</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Activity is shown as context for expenditure and is never added to
            the energy model.
          </p>
          <div className="flex gap-2">
            <NumericField
              aria-label="Steps today"
              value={steps}
              placeholder={String(
                query.data?.activity.find((item) => item.logDate === today)
                  ?.steps ?? "Steps today",
              )}
              onValueChange={setSteps}
            />
            <Button
              disabled={!Number(steps) || mutation.isPending}
              onClick={() => {
                mutation.mutate({
                  url: "/api/body/activity",
                  body: { logDate: today, steps: Number(steps) },
                });
                setSteps("");
              }}
            >
              Save
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Droplets className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Hydration</h2>
            <span className="ml-auto text-sm tabular-nums text-muted-foreground">
              {todayHydration} ml
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[250, 350, 500].map((volume) => (
              <Button
                key={volume}
                variant="outline"
                className="min-h-12"
                disabled={mutation.isPending}
                onClick={() =>
                  mutation.mutate({
                    url: "/api/body/hydration",
                    body: { logDate: today, volume, unit: "ml" },
                  })
                }
              >
                +{volume} ml
              </Button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Check className="size-5 text-primary" />
            <h2 className="text-lg font-bold">Habits</h2>
          </div>
          <SegmentedControl
            ariaLabel="Habit history period"
            value={habitWindow}
            options={[
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
            onValueChange={setHabitWindow}
          />
          <div className="space-y-2">
            {(query.data?.habits ?? []).map((habit) => {
              const completed = habit.completedDates.includes(today);
              const dates = dateRange(today, Number(habitWindow));
              const completedSet = new Set(habit.completedDates);
              const completionCount = dates.filter((date) =>
                completedSet.has(date),
              ).length;
              const streak = habitStreak(completedSet, today);
              return (
                <div key={habit.id} className="rounded-xl bg-muted/40 p-4">
                  <button
                    type="button"
                    className="flex min-h-10 w-full items-center text-left"
                    aria-pressed={completed}
                    onClick={() =>
                      mutation.mutate({
                        url: `/api/habits/${habit.id}/completion`,
                        method: "PUT",
                        body: { logDate: today, completed: !completed },
                      })
                    }
                  >
                    <span
                      className={`mr-3 flex size-7 items-center justify-center rounded-full border ${completed ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                    >
                      {completed ? <Check className="size-4" /> : null}
                    </span>
                    <span className="flex-1 font-medium">{habit.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {streak} day streak
                    </span>
                  </button>
                  <div
                    className={`mt-3 grid gap-1 ${habitWindow === "90" ? "grid-cols-[repeat(15,minmax(0,1fr))]" : "grid-cols-10"}`}
                    aria-hidden="true"
                  >
                    {dates.map((date) => (
                      <span
                        key={date}
                        className={`aspect-square rounded-[2px] ${completedSet.has(date) ? "bg-primary" : "bg-muted-foreground/15"}`}
                      />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {completionCount}/{habitWindow} days completed ·{" "}
                    {habit.targetPerWeek}× weekly target
                  </p>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Input
              value={habitName}
              maxLength={80}
              placeholder="New daily habit"
              onChange={(event) => setHabitName(event.target.value)}
            />
            <Button
              size="icon"
              aria-label="Add habit"
              disabled={!habitName.trim() || mutation.isPending}
              onClick={() => {
                mutation.mutate({
                  url: "/api/habits",
                  body: { name: habitName, targetPerWeek: 7 },
                });
                setHabitName("");
              }}
            >
              <Plus />
            </Button>
          </div>
        </section>
        {query.isError || mutation.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Could not save this update. Try again.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function previousDate(isoDate: string) {
  const value = new Date(`${isoDate}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
}

function dateRange(today: string, numberOfDays: number) {
  const dates = [today];
  while (dates.length < numberOfDays)
    dates.unshift(previousDate(dates[0] ?? today));
  return dates;
}

function habitStreak(completedDates: Set<string>, today: string) {
  let cursor = completedDates.has(today) ? today : previousDate(today);
  let streak = 0;
  while (completedDates.has(cursor)) {
    streak += 1;
    cursor = previousDate(cursor);
  }
  return streak;
}

function MeasurementTrend({
  points,
}: {
  points: BodyOverview["measurements"];
}) {
  if (points.length < 2) return null;
  const values = points.map((point) => point.value);
  const trend: number[] = [];
  for (const value of values)
    trend.push(
      trend.length ? (trend.at(-1) ?? value) * 0.7 + value * 0.3 : value,
    );
  const min = Math.min(...values, ...trend);
  const range = Math.max(0.5, Math.max(...values, ...trend) - min);
  const coordinate = (value: number, index: number) =>
    `${8 + (index / (points.length - 1)) * 84},${42 - ((value - min) / range) * 32}`;
  return (
    <svg
      viewBox="0 0 100 50"
      className="h-28 w-full"
      role="img"
      aria-label="Measurement trend over raw values"
    >
      <polyline
        points={trend.map(coordinate).join(" ")}
        fill="none"
        className="stroke-primary"
        strokeWidth="1.8"
      />
      {values.map((value, index) => {
        const [cx, cy] = coordinate(value, index).split(",");
        return (
          <circle
            key={points[index]?.id}
            cx={cx}
            cy={cy}
            r="1.4"
            className="fill-background stroke-muted-foreground"
          />
        );
      })}
    </svg>
  );
}
