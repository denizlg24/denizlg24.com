"use client";

import { CheckIcon, XIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { createContext, useContext, useMemo } from "react";

import { Button } from "../button";
import { cn } from "../utils";
import type { ToolPart, ToolState } from "./tool";

export type ToolApproval = ToolPart["approval"];

type ConfirmationContextValue = {
  approval: ToolApproval;
  state: ToolState;
};

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null,
);

const useConfirmation = () => {
  const context = useContext(ConfirmationContext);
  if (!context) {
    throw new Error("Confirmation components must be used within Confirmation");
  }
  return context;
};

const isRespondedState = (state: ToolState) =>
  state === "approval-responded" ||
  state === "output-denied" ||
  state === "output-available" ||
  state === "output-error";

export type ConfirmationProps = ComponentProps<"div"> & {
  approval?: ToolApproval;
  state: ToolState;
};

export const Confirmation = ({
  className,
  approval,
  state,
  ...props
}: ConfirmationProps) => {
  const contextValue = useMemo(() => ({ approval, state }), [approval, state]);

  if (!approval || state === "input-streaming" || state === "input-available") {
    return null;
  }

  return (
    <ConfirmationContext.Provider value={contextValue}>
      <div
        data-slot="confirmation"
        data-state={state}
        role={state === "approval-requested" ? "group" : undefined}
        className={cn(
          "mt-1 ml-5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 text-xs",
          className,
        )}
        {...props}
      />
    </ConfirmationContext.Provider>
  );
};

export type ConfirmationTitleProps = ComponentProps<"div">;

export const ConfirmationTitle = ({
  className,
  ...props
}: ConfirmationTitleProps) => (
  <div
    data-slot="confirmation-title"
    className={cn(
      "flex min-w-0 flex-1 basis-40 items-center gap-1.5 text-muted-foreground [&_svg:not([class*='size-'])]:size-3 [&_svg]:shrink-0",
      className,
    )}
    {...props}
  />
);

export type ConfirmationRequestProps = {
  children?: ReactNode;
};

export const ConfirmationRequest = ({ children }: ConfirmationRequestProps) => {
  const { approval, state } = useConfirmation();

  if (state !== "approval-requested") {
    return null;
  }

  return (
    <span className="min-w-0 text-foreground/90 wrap-break-word">
      {children ?? approval?.requestReason}
    </span>
  );
};

export type ConfirmationAcceptedProps = {
  children?: ReactNode;
};

export const ConfirmationAccepted = ({
  children,
}: ConfirmationAcceptedProps) => {
  const { approval, state } = useConfirmation();

  if (!approval?.approved || !isRespondedState(state)) {
    return null;
  }

  return (
    children ?? (
      <>
        <CheckIcon aria-hidden="true" />
        <span className="truncate">Approved</span>
      </>
    )
  );
};

export type ConfirmationRejectedProps = {
  children?: ReactNode;
};

export const ConfirmationRejected = ({
  children,
}: ConfirmationRejectedProps) => {
  const { approval, state } = useConfirmation();

  if (approval?.approved !== false || !isRespondedState(state)) {
    return null;
  }

  return (
    children ?? (
      <>
        <XIcon aria-hidden="true" />
        <span className="truncate">
          Denied
          {approval.reason ? (
            <span className="text-muted-foreground/70">
              {" "}
              · {approval.reason}
            </span>
          ) : null}
        </span>
      </>
    )
  );
};

export type ConfirmationActionsProps = ComponentProps<"div">;

export const ConfirmationActions = ({
  className,
  ...props
}: ConfirmationActionsProps) => {
  const { state } = useConfirmation();

  if (state !== "approval-requested") {
    return null;
  }

  return (
    <div
      data-slot="confirmation-actions"
      className={cn("ml-auto flex shrink-0 items-center gap-1.5", className)}
      {...props}
    />
  );
};

export type ConfirmationActionProps = ComponentProps<typeof Button>;

export const ConfirmationAction = ({
  className,
  variant = "outline",
  ...props
}: ConfirmationActionProps) => (
  <Button
    className={cn("h-7 px-2.5 text-xs shadow-none", className)}
    size="sm"
    type="button"
    variant={variant}
    {...props}
  />
);
