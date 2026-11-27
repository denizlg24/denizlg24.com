"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export type SuggestionsProps = ComponentProps<"ul">;

export const Suggestions = ({ className, ...props }: SuggestionsProps) => (
  <ul
    className={cn("ruled-list flush-top chat-starters", className)}
    {...props}
  />
);

export type SuggestionProps = Omit<ComponentProps<"button">, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  children,
  ...props
}: SuggestionProps) => (
  <li>
    <button type="button" onClick={() => onClick?.(suggestion)} {...props}>
      {children ?? suggestion}
    </button>
  </li>
);
