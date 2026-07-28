import { describe, expect, mock, test } from "bun:test";

const connectDBMock = mock(async () => {});
const readSandboxFileBytesMock = mock(async () =>
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
);
const xlsxBufferToBookMock = mock(() => [
  {
    name: "Budget",
    celldata: [{ r: 0, c: 0, v: { v: "Category" } }],
    row: 10,
    column: 4,
  },
]);
const uploadBookToStorageMock = mock(async () => ({
  cid: "spreadsheets/budget.json",
  id: "spreadsheets/budget.json",
  url: "https://storage.example/budget.json",
  size: 128,
}));
const spreadsheetCreateMock = mock(async (data: Record<string, unknown>) => ({
  ...data,
  _id: { toString: () => "spreadsheet-id" },
}));
const computeStatsMock = mock(() => ({
  sheetCount: 1,
  rowCount: 10,
  colCount: 4,
  totalCells: 40,
}));

mock.module("@/lib/mongodb", () => ({ connectDB: connectDBMock }));
mock.module("@/lib/sandbox", () => ({
  readSandboxFileBytes: readSandboxFileBytesMock,
}));
mock.module("@/lib/spreadsheets", () => ({
  computeStats: computeStatsMock,
  fetchBookFromStorage: mock(async () => []),
  getAllSpreadsheets: mock(async () => []),
  getSpreadsheetById: mock(async () => null),
  uploadBookToStorage: uploadBookToStorageMock,
  xlsxBufferToBook: xlsxBufferToBookMock,
}));
mock.module("@/models/Spreadsheet", () => ({
  Spreadsheet: { create: spreadsheetCreateMock },
}));

const { spreadsheetTools } = await import("./spreadsheets");

describe("spreadsheet tools", () => {
  test("imports sandbox workbooks through the binary server-side path", async () => {
    const tool = spreadsheetTools.find(
      (candidate) => candidate.schema.name === "import_sandbox_spreadsheet",
    );
    if (!tool?.execute) throw new Error("Missing import tool");

    const result = await tool.execute(
      {
        path: "/vercel/sandbox/budget.xlsx",
        title: "Monthly Budget",
        tags: ["finance"],
      },
      { conversationId: "conversation-id" },
    );

    expect(readSandboxFileBytesMock).toHaveBeenCalledWith({
      conversationId: "conversation-id",
      path: "/vercel/sandbox/budget.xlsx",
      maxBytes: 25 * 1024 * 1024,
    });
    expect(xlsxBufferToBookMock).toHaveBeenCalledWith(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(spreadsheetCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Monthly Budget",
        tags: ["finance"],
        sheetCount: 1,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        spreadsheet: expect.objectContaining({
          _id: "spreadsheet-id",
          title: "Monthly Budget",
        }),
      }),
    );
  });

  test("rejects oversized workbooks before upload or persistence", async () => {
    computeStatsMock.mockReturnValue({
      sheetCount: 1,
      rowCount: 501,
      colCount: 4,
      totalCells: 2_004,
    });
    uploadBookToStorageMock.mockClear();
    spreadsheetCreateMock.mockClear();
    const tool = spreadsheetTools.find(
      (candidate) => candidate.schema.name === "import_sandbox_spreadsheet",
    );
    if (!tool?.execute) throw new Error("Missing import tool");

    await expect(
      tool.execute(
        { path: "/vercel/sandbox/oversized.xlsx" },
        { conversationId: "conversation-id" },
      ),
    ).rejects.toThrow("2,000-cell import limit");
    expect(uploadBookToStorageMock).not.toHaveBeenCalled();
    expect(spreadsheetCreateMock).not.toHaveBeenCalled();
  });
});
