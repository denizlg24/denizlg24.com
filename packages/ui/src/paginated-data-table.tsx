"use client";

import {
  type ColumnDef,
  type ColumnFiltersState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type RowData,
  type SortingState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import * as React from "react";

import { Button } from "./button";
import { Input } from "./input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";
import { cn } from "./utils";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    className?: string;
  }
}

const DEFAULT_PAGE_SIZE = 10;
const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50];

type PageItem = number | "start-ellipsis" | "end-ellipsis";

interface FacetFilter {
  columnId: string;
  label: string;
}

interface ManualPagination {
  pageIndex: number;
  pageSize: number;
  totalRows: number;
  loading?: boolean;
  onPaginationChange: (pagination: PaginationState) => void;
}

interface PaginatedDataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  emptyMessage: string;
  initialSorting?: SortingState;
  defaultPageSize?: number;
  pageSizeOptions?: number[];
  onRowClick?: (row: TData) => void;
  /** Opt-in toolbar: text search over all columns. */
  searchPlaceholder?: string;
  /** Opt-in toolbar: per-column selects over the column's distinct values. */
  facetFilters?: FacetFilter[];
  /** Server-backed pagination. Data must contain only the current page. */
  manualPagination?: ManualPagination;
}

function getPageItems(pageIndex: number, pageCount: number): PageItem[] {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  if (pageIndex <= 2) {
    return [0, 1, 2, "end-ellipsis", pageCount - 1];
  }

  if (pageIndex >= pageCount - 3) {
    return [0, "start-ellipsis", pageCount - 3, pageCount - 2, pageCount - 1];
  }

  return [0, "start-ellipsis", pageIndex, "end-ellipsis", pageCount - 1];
}

function PaginatedDataTable<TData>({
  columns,
  data,
  emptyMessage,
  initialSorting = [],
  defaultPageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  onRowClick,
  searchPlaceholder,
  facetFilters,
  manualPagination,
}: PaginatedDataTableProps<TData>) {
  const resolvedPageSizeOptions = Array.from(
    new Set([...pageSizeOptions, defaultPageSize]),
  ).sort((left, right) => left - right);

  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [globalFilter, setGlobalFilter] = React.useState("");
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  );
  const [localPagination, setLocalPagination] = React.useState<PaginationState>(
    {
      pageIndex: 0,
      pageSize: defaultPageSize,
    },
  );
  const pagination = manualPagination
    ? {
        pageIndex: manualPagination.pageIndex,
        pageSize: manualPagination.pageSize,
      }
    : localPagination;

  const handlePaginationChange = React.useCallback(
    (updater: Updater<PaginationState>) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;

      if (manualPagination) {
        manualPagination.onPaginationChange(next);
      } else {
        setLocalPagination(next);
      }
    },
    [manualPagination, pagination],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onPaginationChange: handlePaginationChange,
    manualPagination: manualPagination !== undefined,
    pageCount: manualPagination
      ? Math.ceil(manualPagination.totalRows / manualPagination.pageSize)
      : undefined,
    autoResetPageIndex: manualPagination === undefined,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel:
      manualPagination === undefined ? getPaginationRowModel() : undefined,
  });

  const hasToolbar =
    searchPlaceholder !== undefined || (facetFilters?.length ?? 0) > 0;

  const pageCount = table.getPageCount();
  const totalRows =
    manualPagination?.totalRows ?? table.getFilteredRowModel().rows.length;
  const currentRows = table.getRowModel().rows;
  const currentPage = table.getState().pagination.pageIndex;
  const currentPageSize = table.getState().pagination.pageSize;
  const pageItems = getPageItems(currentPage, pageCount);
  const isLoading = manualPagination?.loading ?? false;
  const rangeStart = totalRows === 0 ? 0 : currentPage * currentPageSize + 1;
  const rangeEnd =
    totalRows === 0
      ? 0
      : Math.min(totalRows, rangeStart + currentRows.length - 1);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {hasToolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {searchPlaceholder !== undefined && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={globalFilter}
                onChange={(event) => setGlobalFilter(event.target.value)}
                placeholder={searchPlaceholder}
                className="h-8 w-64 pl-7 text-xs"
              />
            </div>
          )}
          {facetFilters?.map((facet) => {
            const column = table.getColumn(facet.columnId);
            if (!column) return null;
            const values = Array.from(column.getFacetedUniqueValues().keys())
              .filter((value): value is string => typeof value === "string")
              .sort();
            const current = (column.getFilterValue() as string) ?? "all";
            return (
              <Select
                key={facet.columnId}
                value={current}
                onValueChange={(value) =>
                  column.setFilterValue(value === "all" ? undefined : value)
                }
              >
                <SelectTrigger size="sm" className="w-36 text-xs">
                  <SelectValue placeholder={facet.label} />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="all" className="text-xs">
                    All {facet.label}
                  </SelectItem>
                  {values.map((value) => (
                    <SelectItem key={value} value={value} className="text-xs">
                      {value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            );
          })}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <p className="text-xs text-muted-foreground">
          Showing {rangeStart}-{rangeEnd} of {totalRows}
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Rows</span>
            <Select
              value={String(currentPageSize)}
              onValueChange={(value) => table.setPageSize(Number(value))}
            >
              <SelectTrigger
                size="sm"
                aria-label="Rows per page"
                className="w-28 text-xs"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {resolvedPageSizeOptions.map((pageSize) => (
                  <SelectItem
                    key={pageSize}
                    value={String(pageSize)}
                    className="text-xs"
                  >
                    {pageSize} / page
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {pageCount > 1 && (
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => table.previousPage()}
                disabled={!table.getCanPreviousPage() || isLoading}
              >
                Previous
              </Button>

              {pageItems.map((item) =>
                typeof item === "number" ? (
                  <Button
                    key={item}
                    type="button"
                    variant={item === currentPage ? "outline" : "ghost"}
                    size="sm"
                    className="h-8 min-w-8 px-2 tabular-nums"
                    onClick={() => table.setPageIndex(item)}
                    disabled={isLoading && item !== currentPage}
                  >
                    {item + 1}
                  </Button>
                ) : (
                  <span
                    key={item}
                    className="px-1 text-sm text-muted-foreground"
                  >
                    ...
                  </span>
                ),
              )}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => table.nextPage()}
                disabled={!table.getCanNextPage() || isLoading}
              >
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 overflow-auto">
        <Table containerClassName="overflow-visible">
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    className={cn(
                      "bg-background sticky top-0 z-10 text-xs",
                      header.column.columnDef.meta?.className,
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading && currentRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-20 text-center text-muted-foreground text-xs"
                >
                  Loading...
                </TableCell>
              </TableRow>
            ) : currentRows.length > 0 ? (
              currentRows.map((row) => (
                <TableRow
                  key={row.id}
                  className={onRowClick ? "cursor-pointer" : undefined}
                  onClick={
                    onRowClick ? () => onRowClick(row.original) : undefined
                  }
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={cn(
                        "text-xs",
                        cell.column.columnDef.meta?.className,
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-20 text-center text-muted-foreground text-xs"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export { PaginatedDataTable };
