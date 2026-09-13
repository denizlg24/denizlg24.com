"use client";

import "katex/dist/katex.min.css";

import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import type { UIMessage } from "ai";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type {
  ComponentProps,
  HTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import {
  Children,
  createContext,
  isValidElement,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  type ControlsConfig,
  type LinkSafetyConfig,
  type PluginConfig,
  Streamdown,
} from "streamdown";

import { Button } from "../button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../utils";
import { codeThemes } from "./code-theme";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    data-slot="ai-message"
    data-from={from}
    className={cn(
      "group/ai-message flex w-full min-w-0 flex-col gap-1.5",
      from === "user" ? "ml-auto max-w-[85%] items-end" : "max-w-full",
      className,
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    data-slot="ai-message-content"
    className={cn(
      "flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm text-foreground",
      "group-data-[from=user]/ai-message:rounded-2xl group-data-[from=user]/ai-message:bg-secondary group-data-[from=user]/ai-message:px-3 group-data-[from=user]/ai-message:py-2",
      "group-data-[from=assistant]/ai-message:w-full",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div
    data-slot="ai-message-actions"
    className={cn(
      "flex items-center gap-0.5 text-muted-foreground group-data-[from=user]/ai-message:justify-end",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button
      className={cn(
        "size-7 text-muted-foreground hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      size={size}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
      <span className="sr-only">{label ?? tooltip}</span>
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent sideOffset={4}>{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

type MessageBranchContextValue = {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  setTotalBranches: (count: number) => void;
};

const MessageBranchContext = createContext<MessageBranchContextValue | null>(
  null,
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);
  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch",
    );
  }
  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [totalBranches, setTotalBranches] = useState(0);

  const handleBranchChange = useCallback(
    (next: number) => {
      setCurrentBranch(next);
      onBranchChange?.(next);
    },
    [onBranchChange],
  );

  const goToPrevious = useCallback(() => {
    handleBranchChange(
      currentBranch > 0 ? currentBranch - 1 : totalBranches - 1,
    );
  }, [currentBranch, totalBranches, handleBranchChange]);

  const goToNext = useCallback(() => {
    handleBranchChange(
      currentBranch < totalBranches - 1 ? currentBranch + 1 : 0,
    );
  }, [currentBranch, totalBranches, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextValue>(
    () => ({
      currentBranch,
      goToNext,
      goToPrevious,
      setTotalBranches,
      totalBranches,
    }),
    [currentBranch, goToNext, goToPrevious, totalBranches],
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        data-slot="ai-message-branch"
        className={cn("grid w-full gap-2", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement> & {
  children?: ReactNode;
};

export const MessageBranchContent = ({
  children,
  className,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setTotalBranches } = useMessageBranch();
  const branches = Children.toArray(children).filter(
    (child): child is ReactElement => isValidElement(child),
  );

  useEffect(() => {
    setTotalBranches(branches.length);
  }, [branches.length, setTotalBranches]);

  return branches.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden",
        index === currentBranch ? "block" : "hidden",
        className,
      )}
      key={branch.key ?? index}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<"div">;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  if (totalBranches <= 1) {
    return null;
  }

  return (
    <div
      role="group"
      aria-label="Response versions"
      className={cn(
        "flex items-center gap-0.5 text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  className,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous version"
      className={cn("size-6 text-muted-foreground", className)}
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon className="size-3.5" />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  className,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next version"
      className={cn("size-6 text-muted-foreground", className)}
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-xs"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon className="size-3.5" />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <span
      className={cn(
        "px-0.5 text-xs text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    >
      {currentBranch + 1}/{totalBranches}
    </span>
  );
};

export const messageResponsePlugins: PluginConfig = {
  code: createCodePlugin({ themes: codeThemes }),
  math: createMathPlugin({ singleDollarTextMath: true }),
};

const messageResponseControls: ControlsConfig = {
  code: { copy: true, download: false },
  table: { copy: true, download: false, fullscreen: false },
};

const messageResponseLinkSafety: LinkSafetyConfig = { enabled: false };

const MESSAGE_RESPONSE_CLASSES = cn(
  "size-full min-w-0 space-y-3 text-sm leading-relaxed text-foreground wrap-break-word",
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold [&_h1]:tracking-tight",
  "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold",
  "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
  "[&_:is(h4,h5,h6)]:mt-4 [&_:is(h4,h5,h6)]:mb-1 [&_:is(h4,h5,h6)]:text-sm [&_:is(h4,h5,h6)]:font-medium [&_:is(h4,h5,h6)]:text-muted-foreground",
  "[&_:is(ul,ol)]:pl-1 [&_li]:py-0.5 [&_li::marker]:text-muted-foreground",
  "[&_hr]:my-5 [&_hr]:border-border",
  "[&_[data-streamdown=strong]]:font-semibold",
  "[&_[data-streamdown=blockquote]]:my-3 [&_[data-streamdown=blockquote]]:border-l [&_[data-streamdown=blockquote]]:border-border [&_[data-streamdown=blockquote]]:pl-3 [&_[data-streamdown=blockquote]]:not-italic",
  "[&_[data-streamdown=link]]:font-normal [&_[data-streamdown=link]]:text-foreground [&_[data-streamdown=link]]:underline-offset-2 [&_[data-streamdown=link]]:decoration-muted-foreground/50 [&_[data-streamdown=link]:hover]:decoration-foreground",
  "[&_[data-streamdown=inline-code]]:rounded-sm [&_[data-streamdown=inline-code]]:bg-surface [&_[data-streamdown=inline-code]]:px-1 [&_[data-streamdown=inline-code]]:py-px [&_[data-streamdown=inline-code]]:text-[0.85em]",
  "[&_[data-streamdown=code-block]]:my-3 [&_[data-streamdown=code-block]]:gap-0 [&_[data-streamdown=code-block]]:rounded-md [&_[data-streamdown=code-block]]:border-0 [&_[data-streamdown=code-block]]:bg-surface [&_[data-streamdown=code-block]]:p-0",
  "[&_[data-streamdown=code-block-header]]:h-8 [&_[data-streamdown=code-block-header]]:border-b [&_[data-streamdown=code-block-header]]:border-border/60 [&_[data-streamdown=code-block-header]]:px-2 [&_[data-streamdown=code-block-header]]:text-[11px]",
  "[&_[data-streamdown=code-block-header]+div]:top-0 [&_[data-streamdown=code-block-header]+div]:-mt-8 [&_[data-streamdown=code-block-header]+div]:pr-1",
  "[&_[data-streamdown=code-block-actions]]:gap-0.5 [&_[data-streamdown=code-block-actions]]:border-0 [&_[data-streamdown=code-block-actions]]:bg-surface [&_[data-streamdown=code-block-actions]]:p-0 [&_[data-streamdown=code-block-actions]]:backdrop-blur-none",
  "[&_[data-streamdown=code-block-body]]:rounded-none [&_[data-streamdown=code-block-body]]:border-0 [&_[data-streamdown=code-block-body]]:bg-transparent [&_[data-streamdown=code-block-body]]:p-3 [&_[data-streamdown=code-block-body]]:text-xs [&_[data-streamdown=code-block-body]]:leading-relaxed",
  "[&_[data-streamdown=table-wrapper]]:my-3 [&_[data-streamdown=table-wrapper]]:gap-1 [&_[data-streamdown=table-wrapper]]:rounded-none [&_[data-streamdown=table-wrapper]]:border-0 [&_[data-streamdown=table-wrapper]]:bg-transparent [&_[data-streamdown=table-wrapper]]:p-0",
  "[&_[data-streamdown=table-wrapper]>div:last-child]:rounded-none [&_[data-streamdown=table-wrapper]>div:last-child]:border-0 [&_[data-streamdown=table-wrapper]>div:last-child]:bg-transparent",
  "[&_[data-streamdown=table]]:border-0 [&_[data-streamdown=table]]:text-xs [&_[data-streamdown=table]]:tabular-nums",
  "[&_[data-streamdown=table-header]]:bg-transparent [&_[data-streamdown=table-header]]:border-b [&_[data-streamdown=table-header]]:border-border",
  "[&_[data-streamdown=table-header-cell]]:px-2 [&_[data-streamdown=table-header-cell]]:py-1.5 [&_[data-streamdown=table-header-cell]]:text-xs [&_[data-streamdown=table-header-cell]]:font-medium [&_[data-streamdown=table-header-cell]]:text-muted-foreground",
  "[&_[data-streamdown=table-cell]]:px-2 [&_[data-streamdown=table-cell]]:py-1.5 [&_[data-streamdown=table-cell]]:text-xs",
  "[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden [&_.katex-display]:py-1",
);

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(MESSAGE_RESPONSE_CLASSES, className)}
      controls={messageResponseControls}
      lineNumbers={false}
      linkSafety={messageResponseLinkSafety}
      plugins={messageResponsePlugins}
      {...props}
    />
  ),
  (prev, next) =>
    prev.children === next.children &&
    prev.isAnimating === next.isAnimating &&
    prev.className === next.className &&
    prev.mode === next.mode &&
    prev.caret === next.caret,
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    data-slot="ai-message-toolbar"
    className={cn(
      "mt-1 flex w-full min-w-0 items-center justify-between gap-2",
      className,
    )}
    {...props}
  >
    {children}
  </div>
);
