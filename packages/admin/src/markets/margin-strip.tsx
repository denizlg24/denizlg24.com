"use client";

import type { MarginState } from "@repo/markets/schemas";
import { Badge } from "@repo/ui/badge";
import { Section } from "@repo/ui/section";
import { Stat, StatGroup } from "@repo/ui/stat";
import { money } from "./format";

/**
 * Exposure, requirement and headroom in one row.
 *
 * A margin call takes the section's header rather than sitting as one more
 * muted figure. It is the only state on this page where the difference between
 * noticing and not noticing is the difference between choosing what to close
 * and having it chosen for you.
 */
export function MarginStrip({
  margin,
  baseCurrency,
}: {
  margin: MarginState;
  baseCurrency: string;
}) {
  return (
    <Section
      title="Margin"
      actions={
        margin.marginCall ? (
          <Badge variant="critical" className="tabular-nums">
            Margin call · {money(margin.marginCallAmount)} {baseCurrency}
          </Badge>
        ) : null
      }
    >
      <StatGroup className="sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        <Stat label="Equity" value={money(margin.equity)} />
        <Stat label="Long" value={money(margin.longExposure)} />
        <Stat label="Short" value={money(margin.shortExposure)} />
        <Stat label="Net" value={money(margin.netExposure)} />
        <Stat label="Buying power" value={money(margin.buyingPower)} />
        <Stat
          label="Excess liq"
          value={money(margin.excessLiquidity)}
          tone={
            margin.excessLiquidity < 0
              ? "critical"
              : margin.excessLiquidity > 0
                ? "good"
                : "default"
          }
        />
        <Stat
          label="Leverage"
          value={
            margin.leverage === null ? "—" : `${margin.leverage.toFixed(2)}×`
          }
        />
      </StatGroup>
    </Section>
  );
}
