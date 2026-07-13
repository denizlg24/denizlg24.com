import { describe, expect, mock, test } from "bun:test";

mock.module("./mongodb", () => ({ connectDB: async () => {} }));

const { buildProjectDraftLinks, sanitizeProjectTopicGroups } = await import(
  "./projects"
);

describe("buildProjectDraftLinks", () => {
  test("always includes the canonical repository link", () => {
    expect(
      buildProjectDraftLinks({
        canonicalRepositoryUrl: "https://github.com/acme/widget",
      }),
    ).toEqual([
      {
        label: "Repository",
        url: "https://github.com/acme/widget",
        icon: "github",
      },
    ]);
  });

  test("adds a Website link when demoUrl is provided", () => {
    expect(
      buildProjectDraftLinks({
        canonicalRepositoryUrl: "https://github.com/acme/widget",
        demoUrl: "https://widget.example.com",
      }),
    ).toEqual([
      {
        label: "Repository",
        url: "https://github.com/acme/widget",
        icon: "github",
      },
      {
        label: "Website",
        url: "https://widget.example.com",
        icon: "external",
      },
    ]);
  });

  test("preserves unrelated links while replacing legacy repo and website links", () => {
    const result = buildProjectDraftLinks({
      canonicalRepositoryUrl: "https://github.com/acme/widget",
      demoUrl: "https://widget.example.com",
      existingLinks: [
        {
          label: "Repository",
          url: "https://github.com/acme/widget/",
          icon: "github",
        },
        {
          label: "Website",
          url: "https://old-widget.example.com",
          icon: "external",
        },
        {
          label: "Case Study",
          url: "https://notes.example.com/widget",
          icon: "notepad",
        },
      ],
    });

    expect(result).toEqual([
      {
        label: "Repository",
        url: "https://github.com/acme/widget",
        icon: "github",
      },
      {
        label: "Website",
        url: "https://widget.example.com",
        icon: "external",
      },
      {
        label: "Case Study",
        url: "https://notes.example.com/widget",
        icon: "notepad",
      },
    ]);
  });
});

describe("sanitizeProjectTopicGroups", () => {
  test("trims manual project topics, preserving order", () => {
    expect(
      sanitizeProjectTopicGroups([
        "Infrastructure",
        "Creative Coding",
        " Fullstack ",
        "Infrastructure",
        42,
      ]),
    ).toEqual(["Infrastructure", "Creative Coding", "Fullstack"]);
  });

  test("returns an empty list for missing or invalid input", () => {
    expect(sanitizeProjectTopicGroups(undefined)).toEqual([]);
    expect(sanitizeProjectTopicGroups("Infrastructure")).toEqual([]);
  });
});
