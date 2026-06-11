import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="w-full min-h-screen p-8">
      <div className="max-w-4xl mx-auto text-center space-y-4">
        <h1 className="text-3xl font-bold">Timeline Item Not Found</h1>
        <p className="text-muted-foreground">
          The timeline item you're looking for doesn't exist or has been
          deleted.
        </p>
        <Button asChild>
          <Link href="/admin/dashboard/timeline">Back to Timeline</Link>
        </Button>
      </div>
    </div>
  );
}
