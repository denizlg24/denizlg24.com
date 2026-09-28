import { Check, Plus, ScanBarcode } from "lucide-react";
import {
  type DemoFood,
  demoClock,
  demoPickerDate,
  formatNumber,
  recipe,
  savedMeal,
  suggestedFoods,
} from "@/app/_landing/demo-data";
import {
  delay,
  IosFoodIcon,
  IosGlassButton,
  IosHairline,
  IosMacroInline,
  IosScreen,
  IosSearchBar,
  IosSection,
} from "@/app/_landing/phone/ios";

const LOGGED_AT = 1.6;

function QuickLogButton({ logs }: { logs: boolean }) {
  if (!logs) {
    return (
      <span className="flex size-[32px] flex-none items-center justify-center rounded-full bg-ios-tertiary-fill">
        <Plus size={16} strokeWidth={2.6} />
      </span>
    );
  }
  return (
    <span className="relative size-[32px] flex-none">
      <span
        className="a-tick-off absolute inset-0 flex items-center justify-center rounded-full bg-ios-tertiary-fill opacity-0"
        style={delay(LOGGED_AT)}
      >
        <Plus size={16} strokeWidth={2.6} />
      </span>
      <span
        className="a-tick-on absolute inset-0 flex items-center justify-center rounded-full bg-ios-label text-ios-bg"
        style={delay(LOGGED_AT)}
      >
        <Check size={16} strokeWidth={2.8} />
      </span>
    </span>
  );
}

/** iOS's compact date picker: a tinted pill per component. */
function PickerPill({ children }: { children: string }) {
  return (
    <span className="ios-body rounded-[8px] bg-ios-tertiary-fill px-[11px] py-[6px] font-figure whitespace-nowrap">
      {children}
    </span>
  );
}

/** When the log lands: now, until a day or time is picked. */
function EatenAt() {
  return (
    <div className="flex min-h-[44px] items-center gap-[12px]">
      <span className="ios-body flex-1">Eaten</span>
      <span className="flex gap-[6px]">
        <PickerPill>{demoPickerDate}</PickerPill>
        <PickerPill>{demoClock}</PickerPill>
      </span>
      <span className="ios-subheadline font-semibold text-ios-tertiary">
        Now
      </span>
    </div>
  );
}

function FoodRow({
  food,
  index,
  separator,
  logs = false,
}: {
  food: DemoFood;
  index: number;
  separator: boolean;
  logs?: boolean;
}) {
  return (
    <div className="a-rise" style={delay(0.15 + index * 0.08)}>
      <div
        className={logs ? "a-flash -mx-[16px] px-[16px]" : undefined}
        style={logs ? delay(LOGGED_AT) : undefined}
      >
        <div className="flex items-center gap-[12px] py-[12px]">
          <IosFoodIcon iconKey={food.iconKey} size={36} />
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="ios-body truncate">{food.name}</span>
            <span className="ios-footnote truncate text-ios-secondary">
              {food.amount}
            </span>
            <span className="flex items-baseline gap-[12px]">
              <span className="ios-footnote font-figure">
                {formatNumber(food.calories)}{" "}
                <span className="text-ios-secondary">kcal</span>
              </span>
              <IosMacroInline
                protein={food.protein}
                carbs={food.carbs}
                fat={food.fat}
              />
            </span>
          </div>
          <QuickLogButton logs={logs} />
        </div>
      </div>
      {separator ? <IosHairline inset={48} /> : null}
    </div>
  );
}

export function AddFoodScreen() {
  const suggestedCount = suggestedFoods.length;
  return (
    <>
      <IosScreen
        title="Add food"
        trailing={
          <IosGlassButton>
            <ScanBarcode size={21} strokeWidth={2} />
            <Plus size={22} strokeWidth={2.2} />
          </IosGlassButton>
        }
      >
        <EatenAt />

        <IosSection
          title="Suggested"
          footer="Ranked by what you usually eat around this time."
        >
          {suggestedFoods.map((food, index) => (
            <FoodRow
              key={food.id}
              food={food}
              index={index}
              logs={index === 0}
              separator={index < suggestedCount - 1}
            />
          ))}
        </IosSection>

        <IosSection title="Saved meals">
          <FoodRow food={savedMeal} index={suggestedCount} separator={false} />
        </IosSection>

        <IosSection title="Recipes">
          <FoodRow food={recipe} index={suggestedCount + 1} separator={false} />
        </IosSection>
      </IosScreen>
      <IosSearchBar placeholder="Search foods" />
    </>
  );
}
