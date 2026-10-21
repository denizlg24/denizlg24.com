import { nutrientDefinitionsInput } from "@repo/macros-core/foods/nutrients";
import { NUTRIENT_SECTIONS } from "@repo/macros-core/foods/who-guidelines";
import { formatDecimal, formatInteger } from "@/lib/format";
import { Row, Section } from "@/ui";

const definitions = new Map(
  nutrientDefinitionsInput.map((definition) => [definition.key, definition]),
);

const SHOWN_ELSEWHERE = new Set(["calories", "protein", "carbs", "fat"]);

function formatAmount(value: number, unit: string) {
  const figure = value >= 10 ? formatInteger(value) : formatDecimal(value);
  return `${figure} ${unit}`;
}

/**
 * The breakdowns the web app groups a food's label into, limited to the
 * nutrients the snapshot actually measured — a missing key means unknown,
 * which is different from zero.
 */
export function NutrientRows({
  nutrients,
}: {
  nutrients: Record<string, number>;
}) {
  return (
    <>
      {NUTRIENT_SECTIONS.map((section) => {
        const rows = section.keys.flatMap((key) => {
          const value = nutrients[key];
          const definition = definitions.get(key);
          if (value === undefined || !definition || SHOWN_ELSEWHERE.has(key)) {
            return [];
          }
          return [
            {
              key,
              label: definition.label,
              value: formatAmount(value, definition.unit),
            },
          ];
        });
        if (rows.length === 0) return null;
        return (
          <Section key={section.title} title={section.title}>
            {rows.map((row, index) => (
              <Row
                key={row.key}
                title={row.label}
                value={row.value}
                separator={index < rows.length - 1}
              />
            ))}
          </Section>
        );
      })}
    </>
  );
}
