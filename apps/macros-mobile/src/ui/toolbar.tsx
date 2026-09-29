import { Stack } from "expo-router";
import type { ComponentProps } from "react";

export type ToolbarTextProps = Omit<
  ComponentProps<typeof Stack.Toolbar.Button>,
  "children"
> & { children: string };

/**
 * A text button in a `Stack.Toolbar`. Call it instead of rendering it: the
 * toolbar reads its children's element types, so this must hand back the
 * element itself. Android drops text-only toolbar buttons, so its version
 * (toolbar.android.tsx) draws one inside a `Stack.Toolbar.View`.
 */
export function toolbarText(props: ToolbarTextProps) {
  return <Stack.Toolbar.Button {...props} />;
}

/** Room a screen leaves below its content for a bottom toolbar. iOS insets the scroll view itself. */
export function useBottomToolbarInset(): number {
  return 0;
}
