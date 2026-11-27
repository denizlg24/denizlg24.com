"use client";

import type { ChatStatus } from "ai";
import { ArrowUp, SquareIcon } from "lucide-react";
import type {
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
} from "react";
import { Children, useCallback, useState } from "react";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { cn } from "@/lib/utils";

export interface PromptInputMessage {
  text: string;
}

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit"
> & {
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void;
};

export const PromptInput = ({
  className,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    (event) => {
      event.preventDefault();
      const text = new FormData(event.currentTarget).get("message");
      onSubmit({ text: typeof text === "string" ? text : "" }, event);
    },
    [onSubmit],
  );

  return (
    <form
      className={cn("w-full", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <InputGroup className="overflow-hidden">{children}</InputGroup>
    </form>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div className={cn("contents", className)} {...props} />
);

export type PromptInputTextareaProps = ComponentProps<
  typeof InputGroupTextarea
>;

export const PromptInputTextarea = ({
  onKeyDown,
  className,
  placeholder = "What would you like to know?",
  ...props
}: PromptInputTextareaProps) => {
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (
        event.key !== "Enter" ||
        event.shiftKey ||
        isComposing ||
        event.nativeEvent.isComposing
      )
        return;
      event.preventDefault();

      const { form } = event.currentTarget;
      const submit = form?.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submit?.disabled) return;
      form?.requestSubmit();
    },
    [onKeyDown, isComposing],
  );

  return (
    <InputGroupTextarea
      className={cn("field-sizing-content max-h-48 min-h-9", className)}
      name="message"
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      {...props}
    />
  );
};

export type PromptInputHeaderProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <InputGroupAddon
    align="block-start"
    className={cn("flex-wrap gap-1", className)}
    {...props}
  />
);

export type PromptInputFooterProps = Omit<
  ComponentProps<typeof InputGroupAddon>,
  "align"
>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <InputGroupAddon
    align="block-end"
    className={cn("justify-between gap-1", className)}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    className={cn("flex min-w-0 flex-1 items-center gap-1", className)}
    {...props}
  />
);

export type PromptInputButtonProps = ComponentProps<typeof InputGroupButton>;

export const PromptInputButton = ({
  variant = "ghost",
  size,
  ...props
}: PromptInputButtonProps) => (
  <InputGroupButton
    size={size ?? (Children.count(props.children) > 1 ? "sm" : "icon-sm")}
    type="button"
    variant={variant}
    {...props}
  />
);

export type PromptInputSubmitProps = ComponentProps<typeof InputGroupButton> & {
  status?: ChatStatus;
  onStop?: () => void;
};

export const PromptInputSubmit = ({
  variant,
  size = "sm",
  status,
  onStop,
  onClick,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const isGenerating = status === "submitted" || status === "streaming";
  const stops = isGenerating && onStop !== undefined;

  return (
    <InputGroupButton
      aria-label={stops ? "Stop" : "Send"}
      onClick={(event) => {
        if (isGenerating && onStop) {
          event.preventDefault();
          onStop();
          return;
        }
        onClick?.(event);
      }}
      size={size}
      type={stops ? "button" : "submit"}
      variant={variant ?? (stops ? "outline" : "default")}
      {...props}
    >
      {children ??
        (stops ? (
          <>
            <SquareIcon /> Stop
          </>
        ) : (
          <>
            <ArrowUp /> Send
          </>
        ))}
    </InputGroupButton>
  );
};
