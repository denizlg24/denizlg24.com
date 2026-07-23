import { describe, expect, it } from "bun:test";

import { buildFileDocument, buildFolderDocument } from "./storage";

const DATE = new Date("2026-07-23T12:00:00.000Z");

describe("storage search documents", () => {
  it("preserves file fields and derives shared scope", () => {
    expect(
      buildFileDocument({
        id: "file-id",
        filename: "report.pdf",
        path: "/shared/report.pdf",
        ownerId: "user-id",
        folderId: "folder-id",
        mimeType: "application/pdf",
        sizeBytes: 100,
        tier: "ssd",
        createdAt: DATE,
        updatedAt: DATE,
      }),
    ).toEqual({
      id: "file-id",
      name: "report.pdf",
      path: "/shared/report.pdf",
      type: "file",
      ownerId: "user-id",
      scope: "shared",
      mimeType: "application/pdf",
      sizeBytes: 100,
      tier: "ssd",
      folderId: "folder-id",
      createdAt: DATE.getTime(),
      updatedAt: DATE.getTime(),
    });
  });

  it("does not index ownerless root folders", () => {
    expect(
      buildFolderDocument({
        id: "root-id",
        name: "shared",
        path: "/shared",
        ownerId: null,
        parentId: null,
        createdAt: DATE,
        updatedAt: DATE,
      }),
    ).toBeNull();
  });
});
