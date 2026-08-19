import type { WeightSummary } from "@/lib/weights/contracts"
import { MetricTile } from "./metric-tile"
import { WeightMiniChart } from "./weight-mini-chart"

type Props = {
  weightSummary: WeightSummary
}

export function BodyMetricsSection({ weightSummary }: Props) {
  return (
    <section className="mt-7 px-5">
      <h2 className="mb-4 text-lg font-bold">Body Metrics</h2>
      <div className="grid grid-cols-2 gap-3">
        <MetricTile
          href="/app/weight"
          title="Scale Weight"
          subtitle="Last 7 Entries"
          minHeight="md"
          footer={
            <span className="text-lg font-semibold">
              {weightSummary.latestWeightKg?.toFixed(1) ?? "--"}{" "}
              <span className="text-xs font-medium text-muted-foreground">
                kg
              </span>
            </span>
          }
        >
          <WeightMiniChart points={weightSummary.lastSevenEntries} />
        </MetricTile>
      </div>
    </section>
  )
}
