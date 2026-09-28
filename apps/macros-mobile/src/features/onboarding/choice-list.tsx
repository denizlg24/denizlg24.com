import { haptics } from "@/lib/haptics";
import { colors, Icon, Row } from "@/ui";

export interface Choice<T extends string> {
  value: T;
  label: string;
  description?: string;
}

/**
 * The Settings-style single choice: rows with a checkmark on the chosen one.
 * With `optional`, tapping the chosen row clears it, as on the web wizard.
 */
export function ChoiceList<T extends string>({
  choices,
  value,
  onChange,
  optional = false,
}: {
  choices: readonly Choice<T>[];
  value: T | null;
  onChange: (value: T | null) => void;
  optional?: boolean;
}) {
  return (
    <>
      {choices.map((choice, index) => {
        const selected = choice.value === value;
        return (
          <Row
            key={choice.value}
            title={choice.label}
            subtitle={choice.description}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            trailing={
              selected ? (
                <Icon
                  name="check"
                  size={17}
                  weight="semibold"
                  color={colors.label}
                />
              ) : null
            }
            separator={index < choices.length - 1}
            onPress={() => {
              haptics.selection();
              onChange(selected && optional ? null : choice.value);
            }}
          />
        );
      })}
    </>
  );
}
