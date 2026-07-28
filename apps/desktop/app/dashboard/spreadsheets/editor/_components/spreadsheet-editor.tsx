"use client";

import "@fortune-sheet/react/dist/index.css";
import "./editorial-theme.css";
import { Workbook, type WorkbookInstance } from "@fortune-sheet/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type FortuneSheetBook,
  normalizeFortuneSheetBook,
} from "@/lib/data-types";
import {
  type AutofitCell,
  type AutofitSheet,
  autoFitColumnWidth,
  autoFitRowHeight,
  findResizeIndex,
} from "./spreadsheet-autofit";
import { clearSelectedCellCalls } from "./spreadsheet-keyboard";

interface Props {
  initial: FortuneSheetBook;
  onChange: (book: FortuneSheetBook) => void;
}

type WorkbookProps = React.ComponentProps<typeof Workbook>;
type WorkbookData = WorkbookProps["data"];

function bookFingerprint(book: FortuneSheetBook) {
  return JSON.stringify(
    book.map((typedSheet) => {
      const sheet = typedSheet as typeof typedSheet & {
        id?: string;
        luckysheet_select_save?: unknown;
        luckysheet_selection_range?: unknown;
      };
      const {
        id: _id,
        luckysheet_select_save: _selection,
        luckysheet_selection_range: _selectionRange,
        ...persisted
      } = sheet;
      return persisted;
    }),
  );
}

export default function SpreadsheetEditor({ initial, onChange }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const workbookRef = useRef<WorkbookInstance>(null);
  const initialBook = useMemo(
    () => normalizeFortuneSheetBook(initial),
    [initial],
  );
  const dataRef = useRef<FortuneSheetBook>(initialBook);
  const fingerprintRef = useRef(bookFingerprint(initialBook));
  const measureContextRef = useRef<CanvasRenderingContext2D | null>(null);

  const handleChange = useCallback(
    (data: WorkbookData) => {
      const next = normalizeFortuneSheetBook(data);
      dataRef.current = next;
      const fingerprint = bookFingerprint(next);

      // Fortune Sheet emits after expanding initial sparse data into its
      // runtime matrix. Ignore that and any duplicate no-op emissions.
      if (fingerprint === fingerprintRef.current) return;

      fingerprintRef.current = fingerprint;
      onChange(next);
    },
    [onChange],
  );

  const handleHeaderMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return;
      if (!event.target.closest(".fortune-col-header, .fortune-row-header")) {
        return;
      }

      // Fortune Sheet focuses its hidden keyboard input for cell clicks, but
      // not for row/column header clicks. Restore focus so Delete/Backspace
      // works immediately after selecting a whole row or column.
      requestAnimationFrame(() => {
        editorRef.current
          ?.querySelector<HTMLElement>(".luckysheet-cell-input")
          ?.focus({ preventScroll: true });
      });
    },
    [],
  );

  const handleDeleteKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (
        (event.key !== "Delete" && event.key !== "Backspace") ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      ) {
        return;
      }

      const root = editorRef.current;
      const workbook = workbookRef.current;
      const target = event.target;
      if (!root || !workbook || !(target instanceof Element)) return;

      const inputBox = root.querySelector<HTMLElement>(".luckysheet-input-box");
      const isEditingCell =
        inputBox?.style.zIndex === "19" ||
        (inputBox ? getComputedStyle(inputBox).zIndex === "19" : false);
      const isTextInput =
        target.matches("input, textarea") ||
        (target.closest("[contenteditable='true']") != null &&
          !target.classList.contains("luckysheet-cell-input"));
      if (isEditingCell || isTextInput) return;

      const calls = clearSelectedCellCalls(workbook.getSelection());
      if (calls.length === 0) return;

      event.preventDefault();
      event.stopPropagation();
      workbook.batchCallApis(calls);
    },
    [],
  );

  const measureCellText = useCallback((text: string, cell: AutofitCell) => {
    if (!measureContextRef.current) {
      measureContextRef.current = document
        .createElement("canvas")
        .getContext("2d");
    }
    const context = measureContextRef.current;
    if (!context) return text.length * 7;
    const style = cell.it ? "italic" : "normal";
    const weight = cell.bl ? "bold" : "normal";
    const size = cell.fs ?? 10;
    const family =
      typeof cell.ff === "string" && cell.ff.trim()
        ? cell.ff
        : '"Helvetica Neue", Helvetica, Arial, sans-serif';
    context.font = `${style} ${weight} ${size}pt ${family}`;
    return context.measureText(text).width;
  }, []);

  const handleAutoFit = useCallback(
    (event: MouseEvent) => {
      const root = editorRef.current;
      const workbook = workbookRef.current;
      const target = event.target;
      if (!root || !workbook || !(target instanceof Element)) return;

      const columnHandle = target.closest<HTMLElement>(
        ".fortune-cols-change-size",
      );
      const rowHandle = target.closest<HTMLElement>(
        ".fortune-rows-change-size",
      );
      if (!columnHandle && !rowHandle) return;

      const sheet = workbook.getSheet() as AutofitSheet;
      const zoomRatio = sheet.zoomRatio ?? 1;
      event.preventDefault();
      event.stopPropagation();

      if (columnHandle) {
        const header = root.querySelector<HTMLElement>(".fortune-col-header");
        if (!header) return;
        const count =
          sheet.column ??
          sheet.data?.[0]?.length ??
          Math.max(1, ...(sheet.celldata ?? []).map((cell) => cell.c + 1));
        const columns = Array.from({ length: count }, (_, index) => index);
        const widths = workbook.getColumnWidth(columns);
        const column = findResizeIndex(
          columnHandle.offsetLeft + columnHandle.offsetWidth,
          header.scrollLeft,
          widths,
          count,
          zoomRatio,
        );
        if (column < 0) return;
        workbook.setColumnWidth(
          { [column]: autoFitColumnWidth(sheet, column, measureCellText) },
          {},
          true,
        );
        return;
      }

      const header = root.querySelector<HTMLElement>(".fortune-row-header");
      if (!header || !rowHandle) return;
      const count =
        sheet.row ??
        sheet.data?.length ??
        Math.max(1, ...(sheet.celldata ?? []).map((cell) => cell.r + 1));
      const rows = Array.from({ length: count }, (_, index) => index);
      const heights = workbook.getRowHeight(rows);
      const row = findResizeIndex(
        rowHandle.offsetTop + rowHandle.offsetHeight,
        header.scrollTop,
        heights,
        count,
        zoomRatio,
      );
      if (row < 0) return;
      const columnCount =
        sheet.column ??
        sheet.data?.[row]?.length ??
        Math.max(1, ...(sheet.celldata ?? []).map((cell) => cell.c + 1));
      const columns = Array.from({ length: columnCount }, (_, index) => index);
      workbook.setRowHeight(
        {
          [row]: autoFitRowHeight(
            sheet,
            row,
            workbook.getColumnWidth(columns),
            measureCellText,
          ),
        },
        {},
        true,
      );
    },
    [measureCellText],
  );

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.addEventListener("dblclick", handleAutoFit, true);
    return () => editor.removeEventListener("dblclick", handleAutoFit, true);
  }, [handleAutoFit]);

  return (
    <div
      ref={editorRef}
      className="fortune-editorial w-full h-full min-h-0 flex-1 relative"
      onKeyDownCapture={handleDeleteKeyDown}
      onMouseDownCapture={handleHeaderMouseDown}
    >
      <Workbook
        ref={workbookRef}
        data={initialBook as unknown as WorkbookData}
        onChange={handleChange}
        showToolbar
        showFormulaBar
        showSheetTabs
        lang="en"
      />
    </div>
  );
}
