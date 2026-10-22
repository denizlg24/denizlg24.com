import { useRouter } from "expo-router";
import { useRecipes } from "@/api/recipes";
import { FoodIcon } from "@/components/food-icon";
import { recipeMacroLine } from "@/features/kitchen/recipes/recipe-card";
import {
  isReadyToCook,
  recipeHref,
} from "@/features/kitchen/recipes/recipes-segment";
import { kitchenSegment } from "@/features/kitchen/segment";
import type { EnergyUnit } from "@/lib/format";
import { Row, Section } from "@/ui";

/** A recipe the pantry covers, when there is one; nothing otherwise. */
export function CookTonight({ energyUnit }: { energyUnit: EnergyUnit }) {
  const router = useRouter();
  const ready = (useRecipes().data ?? []).filter(isReadyToCook);
  const first = ready[0];
  if (!first) return null;

  const more = ready.length - 1;
  return (
    <Section
      title="Cook tonight"
      action={
        more > 0
          ? {
              label: `${more} more`,
              onPress: () => {
                kitchenSegment.set("recipes");
                router.navigate("/kitchen");
              },
            }
          : undefined
      }
    >
      <Row
        leading={
          <FoodIcon
            name={first.name}
            iconKey={first.iconKey}
            imageUrl={first.coverImageUrl}
            entryType="recipe"
            size={40}
          />
        }
        title={first.name}
        subtitle={`Everything’s in your pantry · ${recipeMacroLine(first, energyUnit)}`}
        chevron
        separator={false}
        onPress={() => router.push(recipeHref(first.id))}
      />
    </Section>
  );
}
