"use client";

import type {
  ChangeEvent,
  ComponentProps,
  FormEvent,
  HTMLAttributes,
  MouseEvent,
  ReactNode,
} from "react";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export interface QuestionValue {
  selectedValues: readonly string[];
  text: string;
}

export interface QuestionResponse {
  selectedValues: readonly string[];
  text?: string;
}

type SelectionMode = "multiple" | "single";

interface QuestionContextValue {
  disabled: boolean;
  selectedValues: readonly string[];
  selectionMode: SelectionMode;
  setText: (text: string) => void;
  text: string;
  toggleValue: (value: string) => void;
}

const QuestionContext = createContext<QuestionContextValue | null>(null);

const useQuestion = () => {
  const context = useContext(QuestionContext);

  if (!context) {
    throw new Error("Question components must be used within Question");
  }

  return context;
};

export type QuestionProps = Omit<
  ComponentProps<"form">,
  "defaultValue" | "onSubmit" | "value"
> & {
  defaultValue?: QuestionValue;
  disabled?: boolean;
  onSubmit?: (
    response: QuestionResponse,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
  onValueChange?: (value: QuestionValue) => void;
  selectionMode?: SelectionMode;
  value?: QuestionValue;
};

const EMPTY_VALUE: QuestionValue = { selectedValues: [], text: "" };

const getSelectedValues = (
  currentValues: readonly string[],
  optionValue: string,
  selectionMode: SelectionMode,
): readonly string[] => {
  const isSelected = currentValues.includes(optionValue);

  if (selectionMode === "single") {
    return isSelected ? [] : [optionValue];
  }

  if (isSelected) {
    return currentValues.filter((item) => item !== optionValue);
  }

  return [...currentValues, optionValue];
};

export const Question = ({
  children,
  className,
  defaultValue = EMPTY_VALUE,
  disabled = false,
  onSubmit,
  onValueChange,
  selectionMode = "single",
  value: controlledValue,
  ...props
}: QuestionProps) => {
  const [internalValue, setInternalValue] = useState(defaultValue);
  const value = controlledValue ?? internalValue;

  const setValue = useCallback(
    (nextValue: QuestionValue) => {
      if (controlledValue === undefined) {
        setInternalValue(nextValue);
      }
      onValueChange?.(nextValue);
    },
    [controlledValue, onValueChange],
  );

  const setText = useCallback(
    (text: string) => {
      setValue({ ...value, text });
    },
    [setValue, value],
  );

  const toggleValue = useCallback(
    (optionValue: string) => {
      const selectedValues = getSelectedValues(
        value.selectedValues,
        optionValue,
        selectionMode,
      );
      setValue({ ...value, selectedValues });
    },
    [selectionMode, setValue, value],
  );

  const contextValue = useMemo(
    () => ({
      disabled,
      selectedValues: value.selectedValues,
      selectionMode,
      setText,
      text: value.text,
      toggleValue,
    }),
    [disabled, selectionMode, setText, toggleValue, value],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (disabled) {
        return;
      }

      const text = value.text.trim();
      if (value.selectedValues.length === 0 && text.length === 0) {
        return;
      }

      await onSubmit?.(
        {
          selectedValues: value.selectedValues,
          text: text.length > 0 ? text : undefined,
        },
        event,
      );
    },
    [disabled, onSubmit, value],
  );

  return (
    <QuestionContext.Provider value={contextValue}>
      <form
        aria-disabled={disabled || undefined}
        className={cn(
          "grid gap-2 border-rule-strong border-t pt-2 aria-disabled:opacity-60",
          className,
        )}
        onSubmit={handleSubmit}
        {...props}
      >
        {children}
      </form>
    </QuestionContext.Provider>
  );
};

export type QuestionPromptProps = HTMLAttributes<HTMLParagraphElement>;

export const QuestionPrompt = ({
  className,
  ...props
}: QuestionPromptProps) => (
  <p
    className={cn("m-0 font-semibold text-sm leading-snug", className)}
    {...props}
  />
);

export type QuestionDescriptionProps = HTMLAttributes<HTMLParagraphElement>;

export const QuestionDescription = ({
  className,
  ...props
}: QuestionDescriptionProps) => (
  <p
    className={cn("m-0 text-muted-foreground text-xs", className)}
    {...props}
  />
);

export type QuestionOptionsProps = HTMLAttributes<HTMLDivElement>;

export const QuestionOptions = ({
  className,
  ...props
}: QuestionOptionsProps) => {
  const { selectionMode } = useQuestion();

  return (
    <div
      className={cn("grid border-rule border-t", className)}
      role={selectionMode === "single" ? "radiogroup" : "group"}
      {...props}
    />
  );
};

export type QuestionOptionProps = Omit<ComponentProps<"button">, "value"> & {
  value: string;
};

export const QuestionOption = ({
  children,
  className,
  disabled,
  onClick,
  value,
  ...props
}: QuestionOptionProps) => {
  const question = useQuestion();
  const isSelected = question.selectedValues.includes(value);
  const role = question.selectionMode === "single" ? "radio" : "checkbox";
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      question.toggleValue(value);
      onClick?.(event);
    },
    [onClick, question, value],
  );

  return (
    <button
      aria-checked={isSelected}
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)] items-start gap-2 border-rule border-b px-1 py-1.5 text-left text-foreground transition-colors duration-100 hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent aria-checked:bg-secondary aria-checked:text-secondary-foreground",
        className,
      )}
      disabled={question.disabled || disabled}
      onClick={handleClick}
      role={role}
      type="button"
      {...props}
    >
      {children ?? value}
    </button>
  );
};

export type QuestionInputProps = Omit<
  ComponentProps<typeof Input>,
  "defaultValue" | "value"
>;

export const QuestionInput = ({
  className,
  disabled,
  onChange,
  ...props
}: QuestionInputProps) => {
  const question = useQuestion();
  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      question.setText(event.currentTarget.value);
      onChange?.(event);
    },
    [onChange, question],
  );

  return (
    <Input
      className={cn("h-7 min-w-0 flex-1", className)}
      disabled={question.disabled || disabled}
      onChange={handleChange}
      value={question.text}
      {...props}
    />
  );
};

export type QuestionActionsProps = HTMLAttributes<HTMLDivElement>;

export const QuestionActions = ({
  className,
  ...props
}: QuestionActionsProps) => (
  <div className={cn("flex items-center gap-1.5", className)} {...props} />
);

export type QuestionSubmitProps = ComponentProps<typeof Button> & {
  children?: ReactNode;
};

export const QuestionSubmit = ({
  children = "Send",
  disabled,
  size = "sm",
  ...props
}: QuestionSubmitProps) => {
  const question = useQuestion();
  const hasResponse =
    question.selectedValues.length > 0 || question.text.trim().length > 0;

  return (
    <Button
      disabled={question.disabled || disabled || !hasResponse}
      size={size}
      type="submit"
      {...props}
    >
      {children}
    </Button>
  );
};
