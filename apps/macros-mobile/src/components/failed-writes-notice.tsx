import { View } from "react-native";
import { dismissFailedWrite, useFailedWrites } from "@/lib/failed-writes";
import { InlineNotice } from "@/ui";

/** Render near the top of any screen that shows or adds logged food. */
export function FailedWritesNotice() {
  const failures = useFailedWrites();
  if (failures.length === 0) return null;
  return (
    <View>
      {failures.map((failure) => {
        const { retry } = failure;
        return (
          <InlineNotice
            key={failure.id}
            message={`${failure.description} wasn’t saved: ${failure.message}`}
            action={
              retry
                ? {
                    label: "Retry",
                    onPress: () => {
                      dismissFailedWrite(failure.id);
                      retry();
                    },
                  }
                : undefined
            }
            onDismiss={() => dismissFailedWrite(failure.id)}
          />
        );
      })}
    </View>
  );
}
