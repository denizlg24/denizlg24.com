import { type NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import {
  bookToXlsxBuffer,
  fetchBookFromStorage,
  getSpreadsheetById,
} from "@/lib/spreadsheets";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const meta = await getSpreadsheetById(id);
    if (!meta) {
      return NextResponse.json(
        { error: "Spreadsheet not found" },
        { status: 404 },
      );
    }

    const book = await fetchBookFromStorage(meta.pinataHash, meta.pinataUrl);
    const buffer = bookToXlsxBuffer(book);
    const safeName = meta.title.replace(/[^a-z0-9_-]/gi, "_");

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
      },
    });
  } catch (error) {
    const err = error as Error;
    console.error("Error exporting spreadsheet:", err);
    return NextResponse.json(
      { error: "Failed to export spreadsheet", details: err.message },
      { status: 500 },
    );
  }
}
