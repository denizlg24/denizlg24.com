"use client";

import { ArrowRight, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dashboardReturn } from "@/lib/assistant-types";

export function DenizSignIn() {
  return (
    <Button asChild size="lg">
      <a
        href="/auth/login"
        onClick={(event) => {
          const from = dashboardReturn(window.location.hash);
          if (!from) return;
          event.currentTarget.href = `/auth/login?${new URLSearchParams({ from })}`;
        }}
      >
        <ShieldCheck /> Continue with Deniz Cloud <ArrowRight />
      </a>
    </Button>
  );
}

export function PreviewSignIn() {
  return (
    <form
      action="/auth/demo"
      method="post"
      onSubmit={(event) => {
        const field = event.currentTarget.elements.namedItem("from");
        if (field instanceof HTMLInputElement)
          field.value = dashboardReturn(window.location.hash);
      }}
    >
      <input type="hidden" name="from" />
      <Button type="submit" variant="outline" size="lg">
        Open preview <ArrowRight />
      </Button>
    </form>
  );
}
