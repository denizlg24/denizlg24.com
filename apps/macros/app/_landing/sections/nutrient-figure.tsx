import { cn } from "@repo/ui/utils";
import { type DemoNutrient, demoNutrients } from "@/app/_landing/demo-data";
import { InView } from "@/app/_landing/in-view";
import { delay, macroColor } from "@/app/_landing/phone/ios";

const amount = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 1 });

function fillColor(nutrient: DemoNutrient, overLimit: boolean) {
  if (overLimit) return macroColor.overflow;
  return nutrient.macro ? macroColor[nutrient.macro] : "var(--foreground)";
}

export function NutrientFigure() {
  return (
    <InView className="w-full max-w-[26rem]" threshold={0.3}>
      <figure>
        <div aria-hidden="true">
          <div className="flex items-baseline justify-between gap-4 border-b pb-3">
            <span className="text-xl font-semibold tracking-tight">
              Nutrients
            </span>
            <span className="text-sm text-muted-foreground">
              Today · 8 of 50+
            </span>
          </div>
          <ul>
            {demoNutrients.map((nutrient, index) => {
              const progress = nutrient.consumed / nutrient.reference;
              const overLimit = nutrient.kind === "limit" && progress > 1;
              return (
                <li
                  key={nutrient.label}
                  className="flex flex-col gap-2 border-b py-3.5"
                >
                  <span className="flex items-baseline gap-3 text-[15px]">
                    <span className="min-w-0 flex-1 truncate">
                      {nutrient.label}
                    </span>
                    <span
                      className={cn(
                        "font-figure text-sm",
                        overLimit && "font-semibold",
                      )}
                    >
                      {amount.format(nutrient.consumed)} /{" "}
                      {nutrient.kind === "limit" ? "max " : ""}
                      {amount.format(nutrient.reference)} {nutrient.unit}
                    </span>
                    <span className="w-11 text-right font-figure text-sm text-muted-foreground">
                      {Math.round(progress * 100)}%
                    </span>
                  </span>
                  <span className="block h-1 overflow-hidden rounded-full bg-foreground/10">
                    <span
                      className="a-grow-x block h-full rounded-full"
                      style={{
                        ...delay(0.15 + index * 0.07),
                        width: `${Math.min(1, progress) * 100}%`,
                        backgroundColor: fillColor(nutrient, overLimit),
                      }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <figcaption className="sr-only">
          A day’s nutrients against reference intakes:{" "}
          {demoNutrients
            .map(
              (nutrient) =>
                `${nutrient.label} ${amount.format(nutrient.consumed)} of ${nutrient.kind === "limit" ? "a maximum of " : ""}${amount.format(nutrient.reference)} ${nutrient.unit}`,
            )
            .join(", ")}
          . Sodium is over its limit.
        </figcaption>
      </figure>
    </InView>
  );
}
