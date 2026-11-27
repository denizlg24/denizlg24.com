"use client";

import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes } from "react";
import { memo } from "react";
import { Streamdown } from "streamdown";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MessageProps = HTMLAttributes<HTMLElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <article
    className={cn(
      "group grid min-w-0",
      from === "user" ? "is-user" : "is-assistant",
      className,
    )}
    data-role={from}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  className,
  ...props
}: MessageContentProps) => (
  <div className={cn("grid min-w-0 gap-2", className)} {...props} />
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-0.5", className)} {...props} />
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  label: string;
};

export const MessageAction = ({
  label,
  variant = "ghost",
  size = "xs",
  ...props
}: MessageActionProps) => (
  <Button
    aria-label={label}
    size={size}
    type="button"
    variant={variant}
    {...props}
  />
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn("[&>*:first-child]:mt-0 [&>*:last-child]:mb-0", className)}
      {...props}
    />
  ),
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.isAnimating === nextProps.isAnimating &&
    prevProps.mode === nextProps.mode,
);

MessageResponse.displayName = "MessageResponse";
