"use client";

import "@fortune-sheet/react/dist/index.css";
import "./editorial-theme.css";
import { Workbook } from "@fortune-sheet/react";
import { useCallback, useRef } from "react";
import type { FortuneSheetBook } from "@/lib/data-types";

interface Props {
  initial: FortuneSheetBook;
  onChange: (book: FortuneSheetBook) => void;
}

type WorkbookProps = React.ComponentProps<typeof Workbook>;
type WorkbookData = WorkbookProps["data"];

export default function SpreadsheetEditor({ initial, onChange }: Props) {
  const dataRef = useRef<FortuneSheetBook>(initial);

  const handleChange = useCallback(
    (data: WorkbookData) => {
      const next = data as unknown as FortuneSheetBook;
      dataRef.current = next;
      onChange(next);
    },
    [onChange],
  );

  return (
    <div className="fortune-editorial w-full h-full min-h-0 flex-1 relative">
      <Workbook
        data={initial as unknown as WorkbookData}
        onChange={handleChange}
        showToolbar
        showFormulaBar
        showSheetTabs
        lang="en"
      />
    </div>
  );
}
