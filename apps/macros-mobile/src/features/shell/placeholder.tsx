import { EmptyState, Screen } from "@/ui";

/** Stand-in for a screen that has not been built yet. */
export function Placeholder({ title }: { title: string }) {
  return (
    <Screen>
      <EmptyState icon="hammer" title={title} message="Not built yet." />
    </Screen>
  );
}
