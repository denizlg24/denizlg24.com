import {
  formatNumber,
  ingredientAmounts,
  recipe,
  recipeIngredients,
  recipeServings,
  recipeTotalCalories,
  recipeWeightGrams,
} from "@/app/_landing/demo-data";
import { InView } from "@/app/_landing/in-view";
import { delay, macroColor } from "@/app/_landing/phone/ios";

const SPLIT = [
  { key: "protein", label: "Protein", grams: recipe.protein, kcalPerGram: 4 },
  { key: "carbs", label: "Carbs", grams: recipe.carbs, kcalPerGram: 4 },
  { key: "fat", label: "Fat", grams: recipe.fat, kcalPerGram: 9 },
] as const;

export function RecipeFigure() {
  const splitTotal = SPLIT.reduce(
    (sum, part) => sum + part.grams * part.kcalPerGram,
    0,
  );
  const ingredientsDone = 0.2 + recipeIngredients.length * 0.08;

  return (
    <InView className="w-full max-w-[26rem]">
      <figure>
        <div aria-hidden="true">
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xl font-semibold tracking-tight">
              {recipe.name}
            </span>
            <span className="font-figure text-sm text-muted-foreground">
              {recipeServings} servings · {formatNumber(recipeWeightGrams)} g
            </span>
          </div>

          <ol className="mt-5 border-t">
            {recipeIngredients.map((ingredient, index) => (
              <li
                key={ingredient.id}
                className="a-rise flex items-baseline gap-3 border-b py-3 text-[15px]"
                style={delay(0.2 + index * 0.08)}
              >
                <span className="min-w-0 flex-1 truncate">
                  {ingredient.name}
                </span>
                <span className="font-figure text-muted-foreground">
                  {formatNumber(ingredient.grams)} g
                </span>
                <span className="w-16 text-right font-figure">
                  {formatNumber(ingredientAmounts(ingredient).calories)}
                </span>
              </li>
            ))}
          </ol>
          <div
            className="a-fade flex items-baseline justify-between gap-3 border-b-2 border-foreground py-3 text-[15px] font-semibold"
            style={delay(ingredientsDone)}
          >
            <span>Whole pot</span>
            <span className="font-figure">
              {formatNumber(recipeTotalCalories)} kcal
            </span>
          </div>

          <div
            className="a-rise mt-7 flex flex-col gap-4"
            style={delay(ingredientsDone + 0.25)}
          >
            <div className="flex items-baseline justify-between gap-4">
              <span className="eyebrow">Per serving</span>
              <span className="flex items-baseline gap-1.5">
                <span className="font-figure text-[2.75rem] leading-none font-semibold tracking-tight">
                  {formatNumber(recipe.calories)}
                </span>
                <span className="text-sm text-muted-foreground">kcal</span>
              </span>
            </div>
            <div className="flex h-2 gap-[3px]">
              {SPLIT.map((part, index) => (
                <span
                  key={part.key}
                  className="a-grow-x h-full rounded-full"
                  style={{
                    ...delay(ingredientsDone + 0.45 + index * 0.12),
                    flexGrow: part.grams * part.kcalPerGram,
                    flexBasis: 0,
                    backgroundColor: macroColor[part.key],
                  }}
                />
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {SPLIT.map((part) => (
                <span key={part.key} className="flex flex-col gap-0.5">
                  <span className="text-xs text-muted-foreground">
                    {part.label}
                  </span>
                  <span className="font-figure text-lg font-semibold">
                    {part.grams} g
                    <span className="ml-1.5 text-xs font-medium text-muted-foreground">
                      {Math.round(
                        ((part.grams * part.kcalPerGram) / splitTotal) * 100,
                      )}
                      %
                    </span>
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
        <figcaption className="sr-only">
          A turkey chilli recipe: six ingredients weighing{" "}
          {formatNumber(recipeWeightGrams)} g and{" "}
          {formatNumber(recipeTotalCalories)} kcal in total, split into{" "}
          {recipeServings} servings of {recipe.calories} kcal with{" "}
          {recipe.protein} g protein, {recipe.carbs} g carbohydrate and{" "}
          {recipe.fat} g fat.
        </figcaption>
      </figure>
    </InView>
  );
}
