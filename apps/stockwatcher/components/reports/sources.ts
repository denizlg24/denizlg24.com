import type { Chart } from "@/lib/reports/chart";
import { asOfLabel } from "@/lib/reports/format";

export function chartSources(charts: Chart[], cited: string[] = []) {
  const derived = new Map<string, string>();
  for (const chart of charts) {
    const latest = derived.get(chart.source);
    if (!latest || latest < chart.asOf) derived.set(chart.source, chart.asOf);
  }
  return [
    ...cited,
    ...[...derived].map(
      ([source, asOf]) => `${source} — market data as of ${asOfLabel(asOf)}`,
    ),
  ];
}

export function latestAsOf(charts: Chart[]) {
  return charts.reduce<string | null>(
    (latest, chart) => (!latest || chart.asOf > latest ? chart.asOf : latest),
    null,
  );
}
