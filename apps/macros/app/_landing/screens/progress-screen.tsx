import { Plus } from "lucide-react";
import {
  expenditureSeries,
  weightGoalKg,
  weightMonths,
  weightSeries,
  weightStats,
} from "@/app/_landing/demo-data";
import {
  delay,
  IosGlassButton,
  IosScreen,
  IosSection,
  IosSegmented,
  IosStat,
  macroColor,
} from "@/app/_landing/phone/ios";

const WIDTH = 361;
const HEIGHT = 220;
const AXIS_WIDTH = 34;
const DATE_AXIS = 18;
const PLOT_RIGHT = WIDTH - AXIS_WIDTH;
const PLOT_BOTTOM = HEIGHT - DATE_AXIS - 2;
const PLOT_TOP = 6;
const TICKS = [76, 78, 80, 82, 84];
const DOMAIN: readonly [number, number] = [74.4, 84.8];
const LAST_DAY = weightSeries.length - 1;

const x = (day: number) => 4 + (day / LAST_DAY) * (PLOT_RIGHT - 8);
const y = (kg: number) =>
  PLOT_TOP +
  ((DOMAIN[1] - kg) / (DOMAIN[1] - DOMAIN[0])) * (PLOT_BOTTOM - PLOT_TOP);

function linePath(points: ReadonlyArray<readonly [number, number]>) {
  return points
    .map(
      ([px, py], index) =>
        `${index === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`,
    )
    .join(" ");
}

function WeightChart() {
  const trend = weightSeries.map(
    (point) => [x(point.day), y(point.trend)] as const,
  );
  const upper = weightSeries.map(
    (point) => [x(point.day), y(point.trend + point.band)] as const,
  );
  const lower = weightSeries
    .map((point) => [x(point.day), y(point.trend - point.band)] as const)
    .reverse();
  const band = `${linePath(upper)} ${linePath(lower).replace(/^M/, "L")} Z`;
  const last = trend[trend.length - 1];
  const goalY = y(weightGoalKg);

  return (
    <svg width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {TICKS.map((tick) => (
        <g key={tick}>
          <line
            x1={0}
            x2={PLOT_RIGHT}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--ios-separator)"
            strokeWidth={0.75}
          />
          <text
            x={PLOT_RIGHT + 8}
            y={y(tick) + 4}
            fontSize={11}
            fill="var(--ios-secondary)"
            className="font-figure"
          >
            {tick}
          </text>
        </g>
      ))}
      <line
        x1={0}
        x2={PLOT_RIGHT}
        y1={PLOT_BOTTOM}
        y2={PLOT_BOTTOM}
        stroke="var(--ios-separator)"
        strokeWidth={0.75}
      />
      {weightMonths.map((month) => (
        <text
          key={month.label}
          x={x(month.day)}
          y={HEIGHT - 4}
          fontSize={11}
          fill="var(--ios-secondary)"
        >
          {month.label}
        </text>
      ))}
      <path
        d={band}
        fill="var(--ios-label)"
        fillOpacity={0.07}
        className="a-fade"
        style={delay(1)}
      />
      <g className="a-fade" style={delay(1.2)}>
        <line
          x1={0}
          x2={PLOT_RIGHT}
          y1={goalY}
          y2={goalY}
          stroke="var(--ios-secondary)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <text x={2} y={goalY - 5} fontSize={11} fill="var(--ios-secondary)">
          Goal
        </text>
      </g>
      {weightSeries.map((point) =>
        point.scale === null ? null : (
          <circle
            key={point.day}
            cx={x(point.day)}
            cy={y(point.scale)}
            r={2.4}
            fill="var(--ios-tertiary)"
            className="a-fade"
            style={delay(0.2 + (point.day / LAST_DAY) * 1.6)}
          />
        ),
      )}
      <path
        d={linePath(trend)}
        fill="none"
        stroke="var(--ios-label)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={0}
        className="a-draw"
        style={delay(0.2)}
      />
      {last ? (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={4}
          fill="var(--ios-label)"
          className="a-pop"
          style={delay(2)}
        />
      ) : null}
    </svg>
  );
}

const EXP_HEIGHT = 64;

function ExpenditureChart() {
  const count = expenditureSeries.length;
  const lowest = 1900;
  const highest = 2950;
  const step = WIDTH / count;
  const ex = (index: number) => step * index + step / 2;
  const ey = (kcal: number) =>
    EXP_HEIGHT - ((kcal - lowest) / (highest - lowest)) * EXP_HEIGHT;
  const upper = expenditureSeries.map(
    (point, index) => [ex(index), ey(point.high)] as const,
  );
  const lower = expenditureSeries
    .map((point, index) => [ex(index), ey(point.low)] as const)
    .reverse();
  const band = `${linePath(upper)} ${linePath(lower).replace(/^M/, "L")} Z`;
  const line = expenditureSeries.map(
    (point, index) => [ex(index), ey(point.tdee)] as const,
  );

  return (
    <svg
      width={WIDTH}
      height={EXP_HEIGHT}
      viewBox={`0 0 ${WIDTH} ${EXP_HEIGHT}`}
      className="overflow-visible"
    >
      {expenditureSeries.map((point, index) => {
        const top = ey(point.intake);
        return (
          <rect
            key={point.day}
            x={ex(index) - step * 0.32}
            y={top}
            width={step * 0.64}
            height={EXP_HEIGHT - top}
            rx={1.5}
            fill={macroColor.calories}
            fillOpacity={0.45}
            className="a-grow-y"
            style={delay(0.6 + index * 0.02)}
          />
        );
      })}
      <path
        d={band}
        fill="var(--ios-label)"
        fillOpacity={0.08}
        className="a-fade"
        style={delay(1)}
      />
      <path
        d={linePath(line)}
        fill="none"
        stroke="var(--ios-label)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        strokeDasharray="1 1"
        strokeDashoffset={0}
        className="a-draw"
        style={delay(0.9)}
      />
    </svg>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-[16px]">
      <span className="flex items-center gap-[6px]">
        <span className="h-[2px] w-[14px] rounded-full bg-ios-label" />
        <span className="ios-caption1 text-ios-secondary">Trend</span>
      </span>
      <span className="flex items-center gap-[6px]">
        <span className="size-[6px] rounded-full bg-ios-tertiary" />
        <span className="ios-caption1 text-ios-secondary">Scale</span>
      </span>
      <span className="flex items-center gap-[6px]">
        <span className="w-[14px] border-t border-dashed border-ios-secondary" />
        <span className="ios-caption1 font-figure text-ios-secondary">
          Goal {weightGoalKg.toFixed(1)} kg
        </span>
      </span>
    </div>
  );
}

export function ProgressScreen() {
  return (
    <IosScreen
      title="Progress"
      trailing={
        <IosGlassButton>
          <Plus size={22} strokeWidth={2.2} />
        </IosGlassButton>
      }
    >
      <div className="flex flex-col gap-[16px]">
        <IosSegmented options={["1M", "3M", "6M", "1Y", "All"]} value="3M" />
        <div className="flex justify-between gap-[12px]">
          <IosStat
            label="Trend"
            value={weightStats.trend}
            unit="kg"
            size="large"
          />
          <IosStat label="Weekly" value={`${weightStats.weekly} kg/wk`} />
          <IosStat label="Change · 3M" value={`${weightStats.change} kg`} />
        </div>
        <WeightChart />
        <Legend />
      </div>

      <IosSection title="Expenditure" action="Details">
        <div className="flex flex-col gap-[16px]">
          <div className="flex justify-between gap-[12px]">
            <IosStat
              label="Estimate"
              value="2,720"
              unit="kcal"
              size="large"
              detail="2,610–2,830"
            />
            <IosStat label="28 days" value="+60 kcal" />
            <IosStat label="vs formula" value="+6%" detail="2,570 kcal" />
          </div>
          <ExpenditureChart />
        </div>
      </IosSection>
    </IosScreen>
  );
}
