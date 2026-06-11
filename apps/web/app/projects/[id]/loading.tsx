import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function ProjectLoading() {
  return (
    <main className="flex flex-col items-center justify-center animate-in fade-in duration-300">
      <section className="w-full max-w-5xl mx-auto px-4 items-center mt-6">
        <div className="flex justify-center">
          <Skeleton className="h-10 sm:h-12 w-3/4 max-w-md" />
        </div>

        <div className="mt-6 w-full">
          <Skeleton className="w-full aspect-video rounded-lg" />
        </div>

        <div className="flex flex-row items-center justify-start gap-1 flex-wrap w-full mt-4">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-18 rounded-full" />
        </div>

        <Separator className="my-4" />

        <div className="mt-8 space-y-6">
          <Skeleton className="h-8 w-2/3" />

          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-4/5" />
          </div>

          <Skeleton className="h-7 w-1/2 mt-4" />

          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-3/4" />
          </div>

          <Skeleton className="h-32 w-full rounded-lg" />

          <div className="space-y-2">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
          </div>
        </div>
        <Separator className="mt-2" />
        <div className="flex flex-row items-center flex-wrap justify-start gap-2 mt-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-28 rounded-md" />
        </div>
      </section>
    </main>
  );
}
