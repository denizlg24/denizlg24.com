"use client";

import type { ChatStatus, FileUIPart } from "ai";
import { generateId } from "ai";
import {
  ArrowUpIcon,
  CheckIcon,
  ImageIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type {
  ChangeEvent,
  ChangeEventHandler,
  ClipboardEventHandler,
  ComponentProps,
  FormEvent,
  FormEventHandler,
  HTMLAttributes,
  KeyboardEventHandler,
  PropsWithChildren,
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import {
  Children,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "../button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "../command";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../dropdown-menu";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../hover-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../select";
import { Spinner } from "../spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../tooltip";
import { cn } from "../utils";

const readBlobUrlAsDataUrl = async (url: string): Promise<string | null> => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () =>
        resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
};

const revokeBlobUrl = (url: string | undefined) => {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
};

export type PromptInputFile = FileUIPart & { id: string };

const toPromptInputFile = (file: File): PromptInputFile => ({
  filename: file.name,
  id: generateId(),
  mediaType: file.type,
  type: "file",
  url: URL.createObjectURL(file),
});

export type AttachmentsContext = {
  files: PromptInputFile[];
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

export type TextInputContext = {
  value: string;
  setInput: (value: string) => void;
  clear: () => void;
};

export type PromptInputControllerProps = {
  textInput: TextInputContext;
  attachments: AttachmentsContext;
  registerFileInput: (
    ref: RefObject<HTMLInputElement | null>,
    open: () => void,
  ) => void;
};

const PromptInputController = createContext<PromptInputControllerProps | null>(
  null,
);
const ProviderAttachmentsContext = createContext<AttachmentsContext | null>(
  null,
);

export const usePromptInputController = () => {
  const context = useContext(PromptInputController);
  if (!context) {
    throw new Error(
      "usePromptInputController must be used within PromptInputProvider",
    );
  }
  return context;
};

const useOptionalPromptInputController = () =>
  useContext(PromptInputController);

export const useProviderAttachments = () => {
  const context = useContext(ProviderAttachmentsContext);
  if (!context) {
    throw new Error(
      "useProviderAttachments must be used within PromptInputProvider",
    );
  }
  return context;
};

export type PromptInputProviderProps = PropsWithChildren<{
  initialInput?: string;
}>;

/** Lifts composer state above PromptInput so other surfaces (a suggestion row, a hotkey) can write to it. */
export const PromptInputProvider = ({
  initialInput = "",
  children,
}: PromptInputProviderProps) => {
  const [textInput, setTextInput] = useState(initialInput);
  const clearInput = useCallback(() => setTextInput(""), []);

  const [attachmentFiles, setAttachmentFiles] = useState<PromptInputFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const openRef = useRef<() => void>(() => undefined);

  const add = useCallback((files: File[] | FileList) => {
    const incoming = [...files];
    if (incoming.length === 0) {
      return;
    }
    setAttachmentFiles((prev) => [...prev, ...incoming.map(toPromptInputFile)]);
  }, []);

  const remove = useCallback((id: string) => {
    setAttachmentFiles((prev) => {
      revokeBlobUrl(prev.find((file) => file.id === id)?.url);
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    setAttachmentFiles((prev) => {
      for (const file of prev) {
        revokeBlobUrl(file.url);
      }
      return [];
    });
  }, []);

  const attachmentsRef = useRef(attachmentFiles);
  useEffect(() => {
    attachmentsRef.current = attachmentFiles;
  }, [attachmentFiles]);

  useEffect(
    () => () => {
      for (const file of attachmentsRef.current) {
        revokeBlobUrl(file.url);
      }
    },
    [],
  );

  const openFileDialog = useCallback(() => {
    openRef.current();
  }, []);

  const attachments = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef,
      files: attachmentFiles,
      openFileDialog,
      remove,
    }),
    [attachmentFiles, add, remove, clear, openFileDialog],
  );

  const registerFileInput = useCallback(
    (ref: RefObject<HTMLInputElement | null>, open: () => void) => {
      fileInputRef.current = ref.current;
      openRef.current = open;
    },
    [],
  );

  const controller = useMemo<PromptInputControllerProps>(
    () => ({
      attachments,
      registerFileInput,
      textInput: {
        clear: clearInput,
        setInput: setTextInput,
        value: textInput,
      },
    }),
    [textInput, clearInput, attachments, registerFileInput],
  );

  return (
    <PromptInputController.Provider value={controller}>
      <ProviderAttachmentsContext.Provider value={attachments}>
        {children}
      </ProviderAttachmentsContext.Provider>
    </PromptInputController.Provider>
  );
};

const LocalAttachmentsContext = createContext<AttachmentsContext | null>(null);

export const usePromptInputAttachments = () => {
  const provider = useContext(ProviderAttachmentsContext);
  const local = useContext(LocalAttachmentsContext);
  const context = local ?? provider;
  if (!context) {
    throw new Error(
      "usePromptInputAttachments must be used within PromptInput or PromptInputProvider",
    );
  }
  return context;
};

type PromptInputStateValue = {
  hasText: boolean;
  hasAttachments: boolean;
  isDragging: boolean;
  setHasText: (hasText: boolean) => void;
};

const PromptInputStateContext = createContext<PromptInputStateValue | null>(
  null,
);

/** Whether the composer currently holds anything submittable. Safe to call outside PromptInput. */
export const usePromptInputState = () => {
  const context = useContext(PromptInputStateContext);
  return (
    context ?? {
      hasAttachments: false,
      hasText: false,
      isDragging: false,
      setHasText: () => undefined,
    }
  );
};

export type PromptInputMessage = {
  text: string;
  files: FileUIPart[];
};

export type PromptInputError = {
  code: "max_files" | "max_file_size" | "accept";
  message: string;
};

export type PromptInputProps = Omit<
  HTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onError"
> & {
  /** Comma-separated accept list, e.g. `image/*,application/pdf`. */
  accept?: string;
  multiple?: boolean;
  /** Accept drops anywhere on the document instead of only the form. */
  globalDrop?: boolean;
  maxFiles?: number;
  /** Bytes. */
  maxFileSize?: number;
  onError?: (error: PromptInputError) => void;
  /**
   * Takes ownership of every accepted file (picker, paste, drop). The composer
   * then keeps no attachments of its own and `message.files` stays empty —
   * for hosts that upload first and send by URL.
   */
  onFilesAdded?: (files: File[]) => void;
  onSubmit: (
    message: PromptInputMessage,
    event: FormEvent<HTMLFormElement>,
  ) => void | Promise<void>;
};

export const PromptInput = ({
  className,
  accept,
  multiple,
  globalDrop,
  maxFiles,
  maxFileSize,
  onError,
  onFilesAdded,
  onSubmit,
  children,
  ...props
}: PromptInputProps) => {
  const controller = useOptionalPromptInputController();
  const usingProvider = controller !== null;

  const inputRef = useRef<HTMLInputElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  const [localFiles, setLocalFiles] = useState<PromptInputFile[]>([]);
  const files = usingProvider ? controller.attachments.files : localFiles;

  const [hasText, setHasText] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);

  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const matchesAccept = useCallback(
    (file: File) => {
      const patterns = (accept ?? "")
        .split(",")
        .map((pattern) => pattern.trim())
        .filter(Boolean);
      if (patterns.length === 0) {
        return true;
      }
      return patterns.some((pattern) => {
        if (pattern.startsWith(".")) {
          return file.name.toLowerCase().endsWith(pattern.toLowerCase());
        }
        if (pattern.endsWith("/*")) {
          return file.type.startsWith(pattern.slice(0, -1));
        }
        return file.type === pattern;
      });
    },
    [accept],
  );

  const validate = useCallback(
    (fileList: File[] | FileList, currentCount: number): File[] => {
      const incoming = [...fileList];
      const accepted = incoming.filter(matchesAccept);
      if (incoming.length > 0 && accepted.length === 0) {
        onError?.({
          code: "accept",
          message: "No files match the accepted types.",
        });
        return [];
      }
      const sized = accepted.filter((file) =>
        maxFileSize ? file.size <= maxFileSize : true,
      );
      if (accepted.length > 0 && sized.length === 0) {
        onError?.({
          code: "max_file_size",
          message: "All files exceed the maximum size.",
        });
        return [];
      }
      if (typeof maxFiles !== "number") {
        return sized;
      }
      const capacity = Math.max(0, maxFiles - currentCount);
      if (sized.length > capacity) {
        onError?.({
          code: "max_files",
          message: "Too many files. Some were not added.",
        });
      }
      return sized.slice(0, capacity);
    },
    [matchesAccept, maxFileSize, maxFiles, onError],
  );

  const add = useCallback(
    (fileList: File[] | FileList) => {
      const capped = validate(fileList, filesRef.current.length);
      if (capped.length === 0) {
        return;
      }
      if (onFilesAdded) {
        onFilesAdded(capped);
        return;
      }
      if (usingProvider) {
        controller.attachments.add(capped);
        return;
      }
      setLocalFiles((prev) => [...prev, ...capped.map(toPromptInputFile)]);
    },
    [validate, onFilesAdded, usingProvider, controller],
  );

  const removeLocal = useCallback((id: string) => {
    setLocalFiles((prev) => {
      revokeBlobUrl(prev.find((file) => file.id === id)?.url);
      return prev.filter((file) => file.id !== id);
    });
  }, []);

  const clearLocal = useCallback(() => {
    setLocalFiles((prev) => {
      for (const file of prev) {
        revokeBlobUrl(file.url);
      }
      return [];
    });
  }, []);

  const openFileDialogLocal = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const remove = usingProvider ? controller.attachments.remove : removeLocal;
  const clear = usingProvider ? controller.attachments.clear : clearLocal;
  const openFileDialog = usingProvider
    ? controller.attachments.openFileDialog
    : openFileDialogLocal;

  useEffect(() => {
    if (!usingProvider) {
      return;
    }
    controller.registerFileInput(inputRef, () => inputRef.current?.click());
  }, [usingProvider, controller]);

  useEffect(() => {
    if (!globalDrop) {
      return;
    }
    const onDragOver = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) {
        event.preventDefault();
      }
    };
    const onDrop = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) {
        return;
      }
      event.preventDefault();
      if (event.dataTransfer.files.length > 0) {
        add(event.dataTransfer.files);
      }
    };
    document.addEventListener("dragover", onDragOver);
    document.addEventListener("drop", onDrop);
    return () => {
      document.removeEventListener("dragover", onDragOver);
      document.removeEventListener("drop", onDrop);
    };
  }, [add, globalDrop]);

  useEffect(
    () => () => {
      if (!usingProvider) {
        for (const file of filesRef.current) {
          revokeBlobUrl(file.url);
        }
      }
    },
    [usingProvider],
  );

  const hasFilesPayload = (event: ReactDragEvent<HTMLFormElement>) =>
    event.dataTransfer.types.includes("Files");

  const handleDragEnter = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    setDragDepth((depth) => depth + 1);
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!hasFilesPayload(event)) {
      return;
    }
    setDragDepth((depth) => Math.max(0, depth - 1));
  };

  const handleDragOver = (event: ReactDragEvent<HTMLFormElement>) => {
    if (hasFilesPayload(event)) {
      event.preventDefault();
    }
  };

  const handleDrop = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!hasFilesPayload(event)) {
      return;
    }
    event.preventDefault();
    setDragDepth(0);
    if (event.dataTransfer.files.length > 0) {
      add(event.dataTransfer.files);
    }
  };

  const handleChange: ChangeEventHandler<HTMLInputElement> = useCallback(
    (event) => {
      if (event.currentTarget.files) {
        add(event.currentTarget.files);
      }
      event.currentTarget.value = "";
    },
    [add],
  );

  const attachmentsContext = useMemo<AttachmentsContext>(
    () => ({
      add,
      clear,
      fileInputRef: inputRef,
      files,
      openFileDialog,
      remove,
    }),
    [files, add, remove, clear, openFileDialog],
  );

  const stateContext = useMemo<PromptInputStateValue>(
    () => ({
      hasAttachments: files.length > 0,
      hasText: usingProvider
        ? controller.textInput.value.trim().length > 0
        : hasText,
      isDragging: dragDepth > 0,
      setHasText,
    }),
    [files.length, usingProvider, controller, hasText, dragDepth],
  );

  const handleSubmit: FormEventHandler<HTMLFormElement> = useCallback(
    async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const formData = new FormData(form);
      const messageField = formData.get("message");
      const text = usingProvider
        ? controller.textInput.value
        : typeof messageField === "string"
          ? messageField
          : "";

      if (!usingProvider) {
        form.reset();
        setHasText(false);
      }

      const convertedFiles: FileUIPart[] = await Promise.all(
        files.map(async ({ id: _id, ...file }) => {
          if (!file.url.startsWith("blob:")) {
            return file;
          }
          const dataUrl = await readBlobUrlAsDataUrl(file.url);
          return { ...file, url: dataUrl ?? file.url };
        }),
      );

      try {
        await onSubmit({ files: convertedFiles, text }, event);
      } catch {
        return;
      }
      clear();
      if (usingProvider) {
        controller.textInput.clear();
      }
    },
    [usingProvider, controller, files, onSubmit, clear],
  );

  return (
    <LocalAttachmentsContext.Provider value={attachmentsContext}>
      <PromptInputStateContext.Provider value={stateContext}>
        <input
          accept={accept}
          aria-label="Upload files"
          className="hidden"
          multiple={multiple}
          onChange={handleChange}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        <form
          data-slot="prompt-input"
          data-dragging={dragDepth > 0 || undefined}
          className={cn(
            "group/prompt-input relative flex w-full min-w-0 flex-col overflow-hidden rounded-3xl border border-border bg-background shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] transition-[box-shadow,border-color]",
            "focus-within:border-ring/40 data-dragging:border-ring/60 data-dragging:bg-surface/60",
            className,
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onSubmit={handleSubmit}
          ref={formRef}
          {...props}
        >
          {children}
        </form>
      </PromptInputStateContext.Provider>
    </LocalAttachmentsContext.Provider>
  );
};

export type PromptInputBodyProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputBody = ({
  className,
  ...props
}: PromptInputBodyProps) => (
  <div
    data-slot="prompt-input-body"
    className={cn("flex min-w-0 flex-col", className)}
    {...props}
  />
);

export type PromptInputAttachmentsProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "children"
> & {
  children: (file: PromptInputFile) => ReactNode;
};

/** Renders the pending attachments row; hidden when there are none. Pair with `@repo/ui/attachment`. */
export const PromptInputAttachments = ({
  className,
  children,
  ...props
}: PromptInputAttachmentsProps) => {
  const { files } = usePromptInputAttachments();

  if (files.length === 0) {
    return null;
  }

  return (
    <div
      data-slot="prompt-input-attachments"
      className={cn(
        "flex min-w-0 scroll-fade-x gap-2 overflow-x-auto overscroll-x-contain px-3 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
      {...props}
    >
      {files.map((file) => children(file))}
    </div>
  );
};

export type PromptInputTextareaProps = ComponentProps<"textarea">;

export const PromptInputTextarea = ({
  onChange,
  onKeyDown,
  className,
  placeholder = "Message",
  rows = 1,
  ...props
}: PromptInputTextareaProps) => {
  const controller = useOptionalPromptInputController();
  const attachments = usePromptInputAttachments();
  const { setHasText } = usePromptInputState();
  const [isComposing, setIsComposing] = useState(false);

  const handleKeyDown: KeyboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Enter") {
        if (isComposing || event.nativeEvent.isComposing || event.shiftKey) {
          return;
        }
        event.preventDefault();
        const { form } = event.currentTarget;
        const submitButton = form?.querySelector<HTMLButtonElement>(
          'button[type="submit"]',
        );
        if (submitButton?.disabled) {
          return;
        }
        form?.requestSubmit();
      }

      if (
        event.key === "Backspace" &&
        event.currentTarget.value === "" &&
        attachments.files.length > 0
      ) {
        event.preventDefault();
        const last = attachments.files.at(-1);
        if (last) {
          attachments.remove(last.id);
        }
      }
    },
    [onKeyDown, isComposing, attachments],
  );

  const handlePaste: ClipboardEventHandler<HTMLTextAreaElement> = useCallback(
    (event) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) {
            files.push(file);
          }
        }
      }
      if (files.length > 0) {
        event.preventDefault();
        attachments.add(files);
      }
    },
    [attachments],
  );

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const { value } = event.currentTarget;
      if (controller) {
        controller.textInput.setInput(value);
      } else {
        setHasText(value.trim().length > 0);
      }
      onChange?.(event);
    },
    [controller, onChange, setHasText],
  );

  return (
    <textarea
      data-slot="prompt-input-textarea"
      className={cn(
        "field-sizing-content max-h-48 min-h-11 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 disabled:cursor-not-allowed disabled:opacity-50 [scrollbar-width:thin]",
        className,
      )}
      name="message"
      onChange={handleChange}
      onCompositionEnd={() => setIsComposing(false)}
      onCompositionStart={() => setIsComposing(true)}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      placeholder={placeholder}
      rows={rows}
      {...props}
      {...(controller ? { value: controller.textInput.value } : {})}
    />
  );
};

export type PromptInputHeaderProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputHeader = ({
  className,
  ...props
}: PromptInputHeaderProps) => (
  <div
    data-slot="prompt-input-header"
    className={cn(
      "flex min-w-0 flex-wrap items-center gap-1.5 px-3 pt-2.5",
      className,
    )}
    {...props}
  />
);

export type PromptInputFooterProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputFooter = ({
  className,
  ...props
}: PromptInputFooterProps) => (
  <div
    data-slot="prompt-input-footer"
    className={cn(
      "flex min-w-0 items-center justify-between gap-2 px-2 pb-2",
      className,
    )}
    {...props}
  />
);

export type PromptInputToolsProps = HTMLAttributes<HTMLDivElement>;

export const PromptInputTools = ({
  className,
  ...props
}: PromptInputToolsProps) => (
  <div
    data-slot="prompt-input-tools"
    className={cn(
      "flex min-w-0 scroll-fade-x items-center gap-1 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      className,
    )}
    {...props}
  />
);

export type PromptInputButtonTooltip =
  | string
  | {
      content: ReactNode;
      shortcut?: string;
      side?: ComponentProps<typeof TooltipContent>["side"];
    };

export type PromptInputButtonProps = ComponentProps<typeof Button> & {
  tooltip?: PromptInputButtonTooltip;
  /** Marks the pill as active (e.g. a toggled mode); styled like a pressed toggle. */
  active?: boolean;
};

const PILL_CLASSES =
  "h-8 shrink-0 gap-1.5 rounded-full border-border px-3 text-xs font-normal text-muted-foreground shadow-none transition-colors hover:bg-surface hover:text-foreground dark:bg-transparent dark:hover:bg-surface aria-expanded:bg-surface aria-expanded:text-foreground data-[active=true]:border-foreground/30 data-[active=true]:text-foreground [&_svg:not([class*='size-'])]:size-3.5";

export const PromptInputButton = ({
  variant = "outline",
  className,
  size,
  tooltip,
  active,
  children,
  ...props
}: PromptInputButtonProps) => {
  const childArray = Children.toArray(children);
  const iconOnly = childArray.length === 1 && isValidElement(childArray[0]);

  const button = (
    <Button
      data-slot="prompt-input-button"
      data-active={active || undefined}
      aria-pressed={active}
      className={cn(PILL_CLASSES, iconOnly && "size-8 px-0", className)}
      size={size ?? (iconOnly ? "icon-sm" : "sm")}
      type="button"
      variant={variant}
      {...props}
    >
      {children}
    </Button>
  );

  if (!tooltip) {
    return button;
  }

  const content = typeof tooltip === "string" ? tooltip : tooltip.content;
  const shortcut = typeof tooltip === "string" ? undefined : tooltip.shortcut;
  const side = typeof tooltip === "string" ? "top" : (tooltip.side ?? "top");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side={side} sideOffset={4}>
          {content}
          {shortcut ? (
            <span className="ml-2 text-background/70">{shortcut}</span>
          ) : null}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

export type PromptInputActionMenuProps = ComponentProps<typeof DropdownMenu>;

export const PromptInputActionMenu = (props: PromptInputActionMenuProps) => (
  <DropdownMenu {...props} />
);

export type PromptInputActionMenuTriggerProps = PromptInputButtonProps;

export const PromptInputActionMenuTrigger = ({
  children,
  ...props
}: PromptInputActionMenuTriggerProps) => (
  <DropdownMenuTrigger asChild>
    <PromptInputButton {...props}>{children ?? <PlusIcon />}</PromptInputButton>
  </DropdownMenuTrigger>
);

export type PromptInputActionMenuContentProps = ComponentProps<
  typeof DropdownMenuContent
>;

export const PromptInputActionMenuContent = ({
  className,
  align = "start",
  side = "top",
  sideOffset = 6,
  ...props
}: PromptInputActionMenuContentProps) => (
  <DropdownMenuContent
    align={align}
    className={cn("min-w-48 text-xs", className)}
    side={side}
    sideOffset={sideOffset}
    {...props}
  />
);

export type PromptInputActionMenuItemProps = ComponentProps<
  typeof DropdownMenuItem
>;

export const PromptInputActionMenuItem = ({
  className,
  ...props
}: PromptInputActionMenuItemProps) => (
  <DropdownMenuItem
    className={cn(
      "gap-2 text-xs [&_svg:not([class*='size-'])]:size-3.5",
      className,
    )}
    {...props}
  />
);

export type PromptInputActionMenuCheckboxItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

/** Toggleable row: icon + label on the left, a check on the right when active. Stays open on select. */
export const PromptInputActionMenuCheckboxItem = ({
  className,
  children,
  onSelect,
  ...props
}: PromptInputActionMenuCheckboxItemProps) => (
  <DropdownMenuPrimitive.CheckboxItem
    data-slot="prompt-input-action-menu-checkbox-item"
    className={cn(
      "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-7 pl-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground",
      className,
    )}
    onSelect={(event) => {
      event.preventDefault();
      onSelect?.(event);
    }}
    {...props}
  >
    {children}
    <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <CheckIcon className="size-3.5 text-foreground" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.CheckboxItem>
);

export type PromptInputActionMenuRadioGroupProps = ComponentProps<
  typeof DropdownMenuRadioGroup
>;

export const PromptInputActionMenuRadioGroup = (
  props: PromptInputActionMenuRadioGroupProps,
) => <DropdownMenuRadioGroup {...props} />;

export type PromptInputActionMenuRadioItemProps = ComponentProps<
  typeof DropdownMenuPrimitive.RadioItem
>;

export const PromptInputActionMenuRadioItem = ({
  className,
  children,
  ...props
}: PromptInputActionMenuRadioItemProps) => (
  <DropdownMenuPrimitive.RadioItem
    data-slot="prompt-input-action-menu-radio-item"
    className={cn(
      "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-7 pl-2 text-xs outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5 [&_svg:not([class*='text-'])]:text-muted-foreground",
      className,
    )}
    {...props}
  >
    {children}
    <span className="pointer-events-none absolute right-2 flex size-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <CheckIcon className="size-3.5 text-foreground" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
  </DropdownMenuPrimitive.RadioItem>
);

export type PromptInputActionMenuLabelProps = ComponentProps<
  typeof DropdownMenuLabel
>;

export const PromptInputActionMenuLabel = ({
  className,
  ...props
}: PromptInputActionMenuLabelProps) => (
  <DropdownMenuLabel
    className={cn(
      "px-2 py-1 text-[10px] font-medium tracking-wider text-muted-foreground uppercase",
      className,
    )}
    {...props}
  />
);

export type PromptInputActionMenuSeparatorProps = ComponentProps<
  typeof DropdownMenuSeparator
>;

export const PromptInputActionMenuSeparator = (
  props: PromptInputActionMenuSeparatorProps,
) => <DropdownMenuSeparator {...props} />;

export type PromptInputActionAddAttachmentsProps = ComponentProps<
  typeof DropdownMenuItem
> & {
  label?: string;
};

export const PromptInputActionAddAttachments = ({
  label = "Add files",
  className,
  ...props
}: PromptInputActionAddAttachmentsProps) => {
  const attachments = usePromptInputAttachments();

  const handleSelect = useCallback(
    (event: Event) => {
      event.preventDefault();
      attachments.openFileDialog();
    },
    [attachments],
  );

  return (
    <PromptInputActionMenuItem
      className={className}
      {...props}
      onSelect={handleSelect}
    >
      <ImageIcon />
      {label}
    </PromptInputActionMenuItem>
  );
};

export type PromptInputSubmitProps = ComponentProps<typeof Button> & {
  status?: ChatStatus;
  onStop?: () => void;
  /** Overrides the composer's own reading, for attachments held outside it. */
  hasContent?: boolean;
};

export const PromptInputSubmit = ({
  className,
  size = "icon",
  status,
  onStop,
  onClick,
  disabled,
  hasContent: hasContentOverride,
  children,
  ...props
}: PromptInputSubmitProps) => {
  const { hasText, hasAttachments } = usePromptInputState();
  const isGenerating = status === "submitted" || status === "streaming";
  const canStop = isGenerating && onStop !== undefined;
  const hasContent = hasContentOverride ?? (hasText || hasAttachments);

  let icon = <ArrowUpIcon className="size-4" />;
  if (status === "submitted") {
    icon = <Spinner className="size-4" />;
  } else if (status === "streaming") {
    icon = <SquareIcon className="size-3 fill-current" />;
  } else if (status === "error") {
    icon = <XIcon className="size-4" />;
  }

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      if (canStop) {
        event.preventDefault();
        onStop();
        return;
      }
      onClick?.(event);
    },
    [canStop, onStop, onClick],
  );

  return (
    <Button
      data-slot="prompt-input-submit"
      data-status={status}
      aria-label={canStop ? "Stop" : "Send"}
      className={cn(
        "size-9 shrink-0 rounded-full shadow-none transition-colors disabled:opacity-100",
        hasContent || isGenerating
          ? "bg-foreground text-background hover:bg-foreground/85"
          : "bg-muted text-muted-foreground hover:bg-muted",
        className,
      )}
      disabled={disabled ?? (!canStop && (isGenerating || !hasContent))}
      onClick={handleClick}
      size={size}
      type={canStop ? "button" : "submit"}
      variant="default"
      {...props}
    >
      {children ?? icon}
    </Button>
  );
};

export type PromptInputSelectProps = ComponentProps<typeof Select>;

export const PromptInputSelect = (props: PromptInputSelectProps) => (
  <Select {...props} />
);

export type PromptInputSelectTriggerProps = ComponentProps<
  typeof SelectTrigger
>;

export const PromptInputSelectTrigger = ({
  className,
  ...props
}: PromptInputSelectTriggerProps) => (
  <SelectTrigger
    className={cn(
      PILL_CLASSES,
      "h-8! w-auto border bg-transparent py-0 [&_svg:not([class*='text-'])]:text-current",
      className,
    )}
    size="sm"
    {...props}
  />
);

export type PromptInputSelectContentProps = ComponentProps<
  typeof SelectContent
>;

export const PromptInputSelectContent = ({
  className,
  ...props
}: PromptInputSelectContentProps) => (
  <SelectContent className={cn("text-xs", className)} {...props} />
);

export type PromptInputSelectItemProps = ComponentProps<typeof SelectItem>;

export const PromptInputSelectItem = ({
  className,
  ...props
}: PromptInputSelectItemProps) => (
  <SelectItem className={cn("text-xs", className)} {...props} />
);

export type PromptInputSelectValueProps = ComponentProps<typeof SelectValue>;

export const PromptInputSelectValue = (props: PromptInputSelectValueProps) => (
  <SelectValue {...props} />
);

export type PromptInputHoverCardProps = ComponentProps<typeof HoverCard>;

export const PromptInputHoverCard = ({
  openDelay = 100,
  closeDelay = 100,
  ...props
}: PromptInputHoverCardProps) => (
  <HoverCard closeDelay={closeDelay} openDelay={openDelay} {...props} />
);

export type PromptInputHoverCardTriggerProps = ComponentProps<
  typeof HoverCardTrigger
>;

export const PromptInputHoverCardTrigger = (
  props: PromptInputHoverCardTriggerProps,
) => <HoverCardTrigger {...props} />;

export type PromptInputHoverCardContentProps = ComponentProps<
  typeof HoverCardContent
>;

export const PromptInputHoverCardContent = ({
  align = "start",
  side = "top",
  className,
  ...props
}: PromptInputHoverCardContentProps) => (
  <HoverCardContent
    align={align}
    className={cn("text-xs", className)}
    side={side}
    {...props}
  />
);

export type PromptInputCommandProps = ComponentProps<typeof Command>;

export const PromptInputCommand = (props: PromptInputCommandProps) => (
  <Command {...props} />
);

export type PromptInputCommandInputProps = ComponentProps<typeof CommandInput>;

export const PromptInputCommandInput = (
  props: PromptInputCommandInputProps,
) => <CommandInput {...props} />;

export type PromptInputCommandListProps = ComponentProps<typeof CommandList>;

export const PromptInputCommandList = (props: PromptInputCommandListProps) => (
  <CommandList {...props} />
);

export type PromptInputCommandEmptyProps = ComponentProps<typeof CommandEmpty>;

export const PromptInputCommandEmpty = ({
  className,
  ...props
}: PromptInputCommandEmptyProps) => (
  <CommandEmpty
    className={cn("py-4 text-center text-xs text-muted-foreground", className)}
    {...props}
  />
);

export type PromptInputCommandGroupProps = ComponentProps<typeof CommandGroup>;

export const PromptInputCommandGroup = (
  props: PromptInputCommandGroupProps,
) => <CommandGroup {...props} />;

export type PromptInputCommandItemProps = ComponentProps<typeof CommandItem>;

export const PromptInputCommandItem = ({
  className,
  ...props
}: PromptInputCommandItemProps) => (
  <CommandItem className={cn("text-xs", className)} {...props} />
);

export type PromptInputCommandSeparatorProps = ComponentProps<
  typeof CommandSeparator
>;

export const PromptInputCommandSeparator = (
  props: PromptInputCommandSeparatorProps,
) => <CommandSeparator {...props} />;
