import { Button } from "@repo/ui/button";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-sm text-muted-foreground">
        cloud admin — under construction
      </h1>
      <Button variant="outline" size="sm" disabled>
        cloud
      </Button>
    </main>
  );
}
