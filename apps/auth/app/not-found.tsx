"use client";

import { Button } from "@repo/ui/button";
import Link from "next/link";
import { Shell } from "@/components/shell";
import { PageIntro } from "@/components/shell-frame";

export default function NotFound() {
  return (
    <Shell>
      <PageIntro
        title="Page not found"
        description="Nothing lives at this address. The sections are Account, Security and Clients."
      />
      <div>
        <Button asChild variant="outline">
          <Link href="/">Go to Account</Link>
        </Button>
      </div>
    </Shell>
  );
}
