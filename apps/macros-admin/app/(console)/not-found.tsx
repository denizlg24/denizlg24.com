import { Button } from "@repo/ui/button";
import Link from "next/link";

import { PageHeader } from "@/components/page";

export default function ConsoleNotFound() {
  return (
    <>
      <PageHeader
        title="Not found"
        meta={<span className="font-mono">404</span>}
      />
      <div>
        <Button asChild variant="outline" size="sm">
          <Link href="/">Overview</Link>
        </Button>
      </div>
    </>
  );
}
