import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Plus,
} from "lucide-react";
import {
  type DemoEntry,
  demoMonth,
  demoTargets,
  formatNumber,
  justLogged,
  sumMacros,
  todaysHours,
  todaysTotals,
  weekStrip,
} from "@/app/_landing/demo-data";
import {
  delay,
  IosDayRing,
  IosFoodIcon,
  IosGlassButton,
  IosHairline,
  IosMacroBars,
  IosMacroInline,
  IosMeter,
  IosScreen,
  macroColor,
} from "@/app/_landing/phone/ios";

const INSERT_AT = 1.1;

function EntryRow({ entry }: { entry: DemoEntry }) {
  return (
    <div>
      <div className="flex items-center gap-[12px] py-[12px]">
        <IosFoodIcon iconKey={entry.iconKey} size={34} eager />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="ios-body truncate">{entry.name}</span>
          <span className="ios-footnote font-figure truncate text-ios-secondary">
            {entry.amount} · {entry.time}
          </span>
          <IosMacroInline
            protein={entry.protein}
            carbs={entry.carbs}
            fat={entry.fat}
          />
        </div>
        <div className="flex flex-col items-end">
          <span className="ios-headline font-figure">
            {formatNumber(entry.calories)}
          </span>
          <span className="ios-caption2 text-ios-secondary">kcal</span>
        </div>
      </div>
      <IosHairline inset={46} />
    </div>
  );
}

function HourHeader({ label, calories }: { label: string; calories: number }) {
  return (
    <div className="flex items-center gap-[8px] py-[4px]">
      <span className="ios-footnote ios-eyebrow font-figure text-ios-secondary">
        {label}
      </span>
      <span className="h-px flex-1 bg-ios-separator" />
      <span className="ios-footnote font-figure text-ios-secondary">
        {formatNumber(calories)} kcal
      </span>
      <Plus size={17} strokeWidth={2.6} />
    </div>
  );
}

/**
 * An hour of the timeline. The hour the demo logs into is new, so it grows in
 * with its entry — spacing included, so nothing below jumps — and only the
 * entry flashes, the way a first log in a new hour lands in the app.
 */
function HourGroup({
  label,
  entries,
  first,
}: {
  label: string;
  entries: DemoEntry[];
  first: boolean;
}) {
  const inserted = entries.some((entry) => entry.id === justLogged.id);
  const content = (
    <div className={first ? undefined : "pt-[16px]"}>
      <HourHeader label={label} calories={sumMacros(entries).calories} />
      {entries.map((entry) =>
        entry.id === justLogged.id ? (
          <div
            key={entry.id}
            className="a-flash -mx-[16px] px-[16px]"
            style={delay(INSERT_AT)}
          >
            <EntryRow entry={entry} />
          </div>
        ) : (
          <EntryRow key={entry.id} entry={entry} />
        ),
      )}
    </div>
  );
  if (!inserted) return content;
  return (
    <div className="a-insert grid grid-rows-[1fr]" style={delay(INSERT_AT)}>
      <div className="min-h-0 overflow-hidden">
        <div className="a-slide-in" style={delay(INSERT_AT + 0.05)}>
          {content}
        </div>
      </div>
    </div>
  );
}

export function LogScreen() {
  const target = demoTargets.calories;
  const remaining = target - todaysTotals.calories;
  return (
    <IosScreen
      title="Today"
      trailing={
        <IosGlassButton>
          <Calendar size={20} strokeWidth={2} />
          <Ellipsis size={22} strokeWidth={2} />
        </IosGlassButton>
      }
    >
      <div className="flex flex-col gap-[20px]">
        <div className="flex flex-col gap-[8px]">
          <div className="flex items-center gap-[20px]">
            <span className="ios-footnote ios-eyebrow flex-1 text-ios-secondary">
              {demoMonth}
            </span>
            <ChevronLeft
              size={17}
              strokeWidth={2.6}
              className="text-ios-secondary"
            />
            <ChevronRight
              size={17}
              strokeWidth={2.6}
              className="text-ios-tertiary"
            />
          </div>
          <div className="flex justify-between">
            {weekStrip.map((day, index) => (
              <span
                key={day.day}
                className="flex flex-1 flex-col items-center gap-[4px]"
              >
                <span
                  className={
                    day.today
                      ? "ios-caption2 font-semibold"
                      : "ios-caption2 font-semibold text-ios-tertiary"
                  }
                >
                  {day.letter}
                </span>
                <IosDayRing
                  day={day.day}
                  progress={day.calories / target}
                  selected={day.today}
                  today={day.today}
                  disabled={day.future}
                  start={0.1 + index * 0.08}
                />
              </span>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[12px]">
          <div className="flex flex-wrap items-baseline justify-between gap-[12px]">
            <span className="flex items-baseline gap-[4px]">
              <span className="ios-title1 font-figure">
                {formatNumber(todaysTotals.calories)}
              </span>
              <span className="ios-subheadline font-figure text-ios-secondary">
                / {formatNumber(target)} kcal
              </span>
            </span>
            <span className="ios-subheadline font-figure text-ios-secondary">
              {formatNumber(remaining)} left
            </span>
          </div>
          <IosMeter
            value={todaysTotals.calories / target}
            color={macroColor.calories}
            start={0.3}
          />
          <IosMacroBars
            consumed={todaysTotals}
            targets={demoTargets}
            start={0.45}
          />
        </div>

        <div className="flex flex-col">
          {todaysHours.map((hour, index) => (
            <HourGroup
              key={hour.label}
              label={hour.label}
              entries={hour.entries}
              first={index === 0}
            />
          ))}
          <span className="ios-body mt-[16px] flex min-h-[44px] items-center gap-[8px] font-semibold">
            <Plus size={17} strokeWidth={2.6} />
            Add food
          </span>
        </div>
      </div>
    </IosScreen>
  );
}
