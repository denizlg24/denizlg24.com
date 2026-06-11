import { ChevronsUpDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function Loading() {
  return (
    <main className="flex flex-col items-center min-h-screen">
      <section className="w-full max-w-5xl mx-auto px-4 text-center items-center">
        <h1 className="sm:text-5xl text-4xl text-balance font-calistoga text-center">
          projects.
        </h1>

        <div className="w-full flex xs:flex-row flex-col items-center justify-between mt-16 gap-2">
          <Input
            placeholder="Search projects..."
            className="w-full grow max-w-sm"
          />
          <Button
            variant="outline"
            className="xs:w-[200px] w-full justify-between"
          >
            Filter by topic...
            <ChevronsUpDown className="opacity-50" />
          </Button>
        </div>

        <div className="grid md:grid-cols-3 xs:grid-cols-2 grid-cols-1 gap-4 mt-4 pt-4 border-t">
          <div className="w-fit h-[150px] flex items-center justify-center mx-auto col-span-full">
            <Loader2 className="animate-spin" />
          </div>
        </div>
      </section>
    </main>
  );
}
