import { Brain } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const FILTER_SKELETON_IDS = [
  "filter-all",
  "filter-action",
  "filter-scheduled",
  "filter-fyi",
  "filter-newsletters",
] as const;

const ROW_SKELETON_IDS = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
  "row-6",
  "row-7",
  "row-8",
] as const;

const TABLE_HEADERS = [
  "Subject",
  "Category",
  "Suggestions",
  "Confidence",
  "Triaged",
] as const;

function TriageContentSkeleton() {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {TABLE_HEADERS.map((header) => (
            <TableHead key={header} className="text-xs">
              {header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROW_SKELETON_IDS.map((rowId) => (
          <TableRow key={rowId}>
            <TableCell>
              <div className="flex flex-col">
                <Skeleton className="h-3 w-40 max-w-xs" />
                <Skeleton className="mt-2 h-3 w-28 max-w-xs" />
              </div>
            </TableCell>
            <TableCell>
              <Skeleton className="h-5 w-20 rounded-full" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3 w-12" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3 w-10" />
            </TableCell>
            <TableCell>
              <Skeleton className="h-3 w-14" />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function TriageLoadingSkeleton({
  contentOnly = false,
}: {
  contentOnly?: boolean;
}) {
  if (contentOnly) {
    return <TriageContentSkeleton />;
  }

  return (
    <div className="flex flex-col gap-2 pb-8">
      <div className="flex items-center gap-2 px-4 border-b h-12 shrink-0">
        <Brain className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold flex-1">Triage</span>
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="px-4 flex gap-2">
        {FILTER_SKELETON_IDS.map((filterId) => (
          <Skeleton key={filterId} className="h-7 w-20" />
        ))}
      </div>
      <div className="px-4 mt-2">
        <TriageContentSkeleton />
      </div>
    </div>
  );
}
