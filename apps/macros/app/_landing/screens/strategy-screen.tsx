import { ChevronLeft, Pencil } from "lucide-react";
import { formatNumber, programTargets } from "@/app/_landing/demo-data";
import {
  delay,
  IosGlassButton,
  IosHairline,
  IosMacroInline,
  IosScreen,
  IosSection,
  IosStat,
  macroColor,
} from "@/app/_landing/phone/ios";

const MACRO_TARGETS = [
  { key: "protein", label: "Protein" },
  { key: "carbs", label: "Carbs" },
  { key: "fat", label: "Fat" },
] as const;

function MacroTargets({
  grams,
  start,
}: {
  grams: { protein: number; carbs: number; fat: number };
  start: number;
}) {
  return (
    <div className="flex gap-[16px]">
      {MACRO_TARGETS.map(({ key, label }, index) => (
        <div key={key} className="flex flex-1 flex-col gap-[4px]">
          <span
            className="a-grow-x h-[3px] w-[16px] rounded-full"
            style={{
              ...delay(start + index * 0.1),
              backgroundColor: macroColor[key],
            }}
          />
          <span className="ios-caption1 ios-eyebrow text-ios-secondary">
            {label}
          </span>
          <span className="flex items-baseline gap-[4px]">
            <span className="ios-title3 font-figure">{grams[key]}</span>
            <span className="ios-footnote text-ios-secondary">g</span>
          </span>
        </div>
      ))}
    </div>
  );
}

export function StrategyScreen() {
  const { next, current, days } = programTargets;
  return (
    <IosScreen
      title="Strategy"
      leading={
        <IosGlassButton>
          <ChevronLeft size={24} strokeWidth={2.2} />
        </IosGlassButton>
      }
      trailing={
        <IosGlassButton>
          <Pencil size={19} strokeWidth={2} />
        </IosGlassButton>
      }
    >
      <div className="a-rise" style={delay(0.1)}>
        <IosSection
          title="New targets"
          footer="Your current targets stay in place until you accept."
        >
          <div className="flex flex-col gap-[16px]">
            <IosStat
              label={`From ${next.from}`}
              value={formatNumber(next.calories)}
              unit="kcal"
              size="large"
              detail={`${next.change} kcal vs now`}
            />
            <MacroTargets grams={next} start={0.5} />
            <span className="ios-footnote text-ios-secondary">
              Estimated expenditure at the time: {next.expenditure} kcal ±{" "}
              {next.uncertainty}.
            </span>
            <span className="ios-headline flex h-[50px] items-center justify-center rounded-[12px] bg-ios-label text-ios-bg">
              Accept new targets
            </span>
          </div>
        </IosSection>
      </div>

      <div className="a-rise" style={delay(0.35)}>
        <IosSection title="This week">
          <div className="flex flex-col gap-[16px]">
            <IosStat
              label="Calories"
              value={formatNumber(current.calories)}
              unit="kcal"
              size="hero"
              detail={`${current.change} kcal from the previous target`}
            />
            <MacroTargets grams={current} start={0.75} />
            <span className="ios-footnote text-ios-secondary">
              Since {current.since} · Check-in
            </span>
            <div>
              {days.map((day, index) => (
                <div key={day.day}>
                  <div className="flex items-center gap-[12px] py-[10px]">
                    <span
                      className={
                        day.day === "Tue"
                          ? "ios-subheadline w-[40px] font-semibold"
                          : "ios-subheadline w-[40px]"
                      }
                    >
                      {day.day}
                    </span>
                    <span className="flex-1">
                      <IosMacroInline
                        protein={day.protein}
                        carbs={day.carbs}
                        fat={day.fat}
                      />
                    </span>
                    <span
                      className={
                        day.day === "Tue"
                          ? "ios-subheadline font-figure font-semibold"
                          : "ios-subheadline font-figure"
                      }
                    >
                      {formatNumber(day.calories)}
                    </span>
                  </div>
                  {index < days.length - 1 ? <IosHairline /> : null}
                </div>
              ))}
            </div>
          </div>
        </IosSection>
      </div>
    </IosScreen>
  );
}
