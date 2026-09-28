import { Plus } from "lucide-react";
import {
  demoDateLine,
  demoHabits,
  demoTargets,
  energySummary,
  formatNumber,
  todaysTotals,
} from "@/app/_landing/demo-data";
import {
  delay,
  IosCalorieRing,
  IosCheckCircle,
  IosGlassButton,
  IosHairline,
  IosMacroBars,
  IosMeter,
  IosScreen,
  IosSection,
  macroColor,
} from "@/app/_landing/phone/ios";

function Flank({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-[2px]">
      <span className="ios-caption1 ios-eyebrow text-ios-secondary">
        {label}
      </span>
      <span className="ios-title3 font-figure">{value}</span>
      <span className="ios-caption2 text-ios-tertiary">kcal</span>
    </div>
  );
}

const CHART_HEIGHT = 52;
const BAR_GAP = 3;
const CHART_WIDTH = 150;

function EnergyBars() {
  const { days, scale } = energySummary;
  const barWidth = (CHART_WIDTH - BAR_GAP * (days.length - 1)) / days.length;
  const y = (kcal: number) =>
    CHART_HEIGHT - Math.min(1, kcal / scale) * (CHART_HEIGHT - 2);
  return (
    <div className="flex w-[150px] flex-none flex-col gap-[4px]">
      <svg
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      >
        {days.map((day, index) => {
          const top = y(day.consumed);
          return (
            <rect
              key={`bar-${index}`}
              x={index * (barWidth + BAR_GAP)}
              y={top}
              width={barWidth}
              height={CHART_HEIGHT - top}
              rx={1.5}
              fill={day.over ? macroColor.overflow : macroColor.calories}
              className="a-grow-y"
              style={delay(0.5 + index * 0.06)}
            />
          );
        })}
        {days.map((day, index) => (
          <line
            key={`tdee-${index}`}
            x1={index * (barWidth + BAR_GAP) - 0.5}
            x2={index * (barWidth + BAR_GAP) + barWidth + 0.5}
            y1={y(day.expenditure)}
            y2={y(day.expenditure)}
            stroke="var(--ios-label)"
            strokeWidth={1.5}
            strokeLinecap="round"
            className="a-fade"
            style={delay(1 + index * 0.05)}
          />
        ))}
      </svg>
      <div className="flex gap-[3px]">
        {days.map((day, index) => (
          <span
            key={`letter-${index}`}
            className={
              index === days.length - 1
                ? "ios-caption2 flex-1 text-center font-semibold text-ios-secondary"
                : "ios-caption2 flex-1 text-center text-ios-tertiary"
            }
          >
            {day.letter}
          </span>
        ))}
      </div>
    </div>
  );
}

export function TodayScreen() {
  const adherence = energySummary.daysOnTarget / energySummary.daysTracked;
  return (
    <IosScreen
      title="Today"
      trailing={
        <IosGlassButton>
          <Plus size={22} strokeWidth={2.2} />
        </IosGlassButton>
      }
    >
      <div className="-mb-[12px] ios-subheadline text-ios-secondary">
        {demoDateLine}
      </div>

      <IosSection title="Nutrition" action="Food log">
        <div className="flex flex-col gap-[20px] py-[8px]">
          <div className="flex items-center gap-[8px]">
            <Flank label="Eaten" value={formatNumber(todaysTotals.calories)} />
            <IosCalorieRing
              consumed={todaysTotals.calories}
              target={demoTargets.calories}
              start={0.15}
            />
            <Flank label="Target" value={formatNumber(demoTargets.calories)} />
          </div>
          <IosMacroBars
            consumed={todaysTotals}
            targets={demoTargets}
            start={0.55}
          />
        </div>
      </IosSection>

      <IosSection title="Habits" action="Edit">
        {demoHabits.map((habit, index) => (
          <div key={habit.id}>
            <div className="flex items-center gap-[12px] py-[11px]">
              <IosCheckCircle done={habit.done} />
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <span className="ios-body truncate">{habit.name}</span>
                <span className="ios-subheadline text-ios-secondary">
                  {habit.count} of {habit.target} this week
                </span>
              </div>
            </div>
            {index < demoHabits.length - 1 ? <IosHairline /> : null}
          </div>
        ))}
      </IosSection>

      <IosSection title="Energy" action="Progress">
        <div className="flex items-center gap-[16px] py-[12px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="ios-caption1 ios-eyebrow text-ios-secondary">
              Balance · 7 days
            </span>
            <span className="flex flex-wrap items-baseline gap-[4px]">
              <span className="ios-title2 font-figure">
                {formatNumber(energySummary.deficit)}
              </span>
              <span className="ios-footnote text-ios-secondary">
                kcal deficit
              </span>
            </span>
            <span className="ios-footnote text-ios-secondary">
              Intake against expenditure
            </span>
          </div>
          <EnergyBars />
        </div>
        <IosHairline />
        <div className="flex flex-col gap-[8px] py-[12px]">
          <div className="flex items-center gap-[16px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="ios-caption1 ios-eyebrow text-ios-secondary">
                On target
              </span>
              <span className="ios-footnote text-ios-secondary">
                {energySummary.daysOnTarget} of {energySummary.daysTracked} full
                days no more than 10% over
              </span>
            </div>
            <span className="ios-title2 font-figure">
              {Math.round(adherence * 100)}%
            </span>
          </div>
          <IosMeter value={adherence} color={macroColor.calories} start={0.9} />
        </div>
      </IosSection>
    </IosScreen>
  );
}
