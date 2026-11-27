"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex w-full items-center rounded-md border border-input bg-card transition-[border-color] duration-100 outline-none hover:border-rule-strong/40",
        "h-8 min-w-0 has-[>textarea]:h-auto",
        "has-[>[data-align=inline-start]]:[&>input]:pl-2",
        "has-[>[data-align=inline-end]]:[&>input]:pr-2",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:outline-1 has-[[data-slot=input-group-control]:focus-visible]:outline-ring",
        "has-[[data-slot][aria-invalid=true]]:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 py-1 text-muted-foreground text-xs select-none group-data-[disabled=true]/input-group:opacity-50 [&>svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      align: {
        "inline-start":
          "order-first pl-2.5 has-[>button]:ml-[-0.35rem] has-[>kbd]:ml-[-0.25rem]",
        "inline-end":
          "order-last pr-2.5 has-[>button]:mr-[-0.35rem] has-[>kbd]:mr-[-0.25rem]",
        "block-start": "order-first w-full justify-start px-2.5 pt-2",
        "block-end": "order-last w-full justify-start px-1 pb-1",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
);

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(event) => {
        if (
          event.target instanceof Element &&
          event.target.closest("button, a, input, textarea")
        )
          return;
        event.currentTarget.parentElement
          ?.querySelector<HTMLElement>("[data-slot=input-group-control]")
          ?.focus();
      }}
      {...props}
    />
  );
}

const inputGroupButtonVariants = cva("flex items-center gap-1.5 shadow-none", {
  variants: {
    size: {
      xs: "h-6 gap-1 px-2 has-[>svg]:px-1.5 [&>svg:not([class*='size-'])]:size-3",
      sm: "h-7 gap-1 px-2.5 has-[>svg]:px-2",
      "icon-xs": "size-6 p-0 has-[>svg]:p-0",
      "icon-sm": "size-7 p-0 has-[>svg]:p-0",
    },
  },
  defaultVariants: {
    size: "xs",
  },
});

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size"> &
  VariantProps<typeof inputGroupButtonVariants>) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  );
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-muted-foreground text-xs [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "flex-1 rounded-none border-0 bg-transparent shadow-none hover:border-0 focus-visible:outline-0",
        className,
      )}
      {...props}
    />
  );
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none hover:border-0 focus-visible:outline-0",
        className,
      )}
      {...props}
    />
  );
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
};
