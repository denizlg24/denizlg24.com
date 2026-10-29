import { Skeleton } from "@repo/ui/skeleton";

const ROW_WIDTHS = ["w-3/5", "w-2/5", "w-4/5", "w-1/2", "w-3/4"];

export function VoiceNoteListSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {[4, 3].map((rows, group) => (
        <div key={group} className="flex flex-col gap-1">
          <div className="flex items-center gap-3 py-1">
            <Skeleton className="h-2.5 w-14" />
            <Skeleton className="h-px flex-1" />
            <Skeleton className="h-2.5 w-10" />
          </div>
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex flex-col gap-1.5 py-1.5 pl-8">
              <div className="flex items-center gap-3">
                <Skeleton
                  className={`h-3.5 ${ROW_WIDTHS[(group + index) % ROW_WIDTHS.length]}`}
                />
                <Skeleton className="ml-auto h-3 w-9 shrink-0" />
                <Skeleton className="h-3 w-10 shrink-0" />
              </div>
              {index % 2 === 0 && (
                <div className="flex items-center gap-2">
                  <Skeleton className="h-2 w-20" />
                  <Skeleton className="h-2 w-10" />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function VoiceNoteTranscriptSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex gap-3">
          <Skeleton className="h-3 w-10 shrink-0" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-full" />
            <Skeleton
              className={`h-3 ${ROW_WIDTHS[index % ROW_WIDTHS.length]}`}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

export function VoiceNoteDetailSkeleton() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 pt-6 sm:px-8">
      <Skeleton className="h-7 w-1/2" />
      <div className="flex flex-col gap-3">
        {[28, 20, 44, 32].map((width) => (
          <div key={width} className="flex items-center gap-3">
            <Skeleton className="h-3.5 w-24 shrink-0" />
            <Skeleton className="h-3.5" style={{ width: `${width}%` }} />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-14 w-full" />
        <div className="flex items-center gap-1">
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="size-7 rounded-full" />
          <Skeleton className="ml-1 h-3 w-8" />
          <Skeleton className="ml-auto h-3 w-20" />
        </div>
      </div>
      <VoiceNoteTranscriptSkeleton />
    </div>
  );
}

export function VoiceNotesPageSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 items-center gap-2 border-b px-3">
        <Skeleton className="size-4" />
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="ml-auto h-7 w-20" />
        <Skeleton className="h-7 w-20" />
      </div>
      <div className="flex min-h-10 items-center gap-2 border-b px-3">
        <Skeleton className="h-7 w-56" />
        {[10, 12, 16, 22, 20].map((width, index) => (
          <Skeleton
            key={index}
            className="h-7"
            style={{ width: `${width * 4}px` }}
          />
        ))}
        <Skeleton className="ml-auto h-7 w-20" />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-full md:w-[22rem] md:shrink-0 md:border-r lg:w-[26rem]">
          <VoiceNoteListSkeleton />
        </div>
        <div className="hidden min-w-0 flex-1 md:block">
          <VoiceNoteDetailSkeleton />
        </div>
      </div>
    </div>
  );
}
