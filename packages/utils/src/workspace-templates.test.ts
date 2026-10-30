import { describe, expect, test } from "bun:test";
import type { Block } from "@repo/schemas";
import { genBlocks, rng } from "./workspace-gen.test-util";
import {
  fillTemplate,
  instantiateTemplateBlocks,
  isoWeek,
  type TemplateContext,
  templateClock,
  templateInputNames,
} from "./workspace-templates";
import { treeIds } from "./workspace-tree";

const context: TemplateContext = {
  date: "2026-10-30",
  time: "09:05",
  week: "2026-W44",
  weekday: "Friday",
  pageTitle: "Daily",
  inputs: { Topic: "Workflows" },
};

function ids(prefix = "n") {
  let n = 0;
  return () => `${prefix}${++n}`;
}

describe("templateClock", () => {
  test("reads the clock in the given zone", () => {
    const now = new Date("2026-10-30T23:30:00Z");
    expect(templateClock(now, "UTC")).toEqual({
      date: "2026-10-30",
      time: "23:30",
      week: "2026-W44",
      weekday: "Friday",
    });
    expect(templateClock(now, "Europe/Copenhagen").date).toBe("2026-10-31");
    expect(templateClock(now, "Europe/Copenhagen").weekday).toBe("Saturday");
  });

  test("ISO weeks across year ends", () => {
    expect(isoWeek("2026-01-01")).toBe("2026-W01");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
  });
});

describe("fillTemplate", () => {
  test("fills known variables and inputs, keeps unknown ones", () => {
    expect(
      fillTemplate(
        "{{date}} {{ time }} {{week}} {{weekday}} {{page.title}} {{input:Topic}} {{input:Missing}}|{{nope}}",
        context,
      ),
    ).toBe("2026-10-30 09:05 2026-W44 Friday Daily Workflows |{{nope}}");
  });
});

describe("instantiateTemplateBlocks", () => {
  const template: Block[] = [
    {
      id: "h",
      type: "heading",
      level: 1,
      text: [{ type: "text", text: "{{weekday}} {{date}}" }],
    },
    {
      id: "t",
      type: "toggle",
      text: [{ type: "text", text: "About {{input:Topic}}", bold: true }],
      children: [
        {
          id: "m",
          type: "paragraph",
          text: [
            { type: "mention", kind: "page", id: "p", label: "{{page.title}}" },
            { type: "text", text: "{{input:Empty}}" },
          ],
        },
      ],
    },
    { id: "c", type: "code", code: "{{date}}", language: "" },
    { id: "v", type: "agenda", title: "Week {{week}}" },
  ];

  test("gives every block a fresh id and fills text", () => {
    const out = instantiateTemplateBlocks(template, context, ids());
    expect(treeIds(out)).toEqual(["n1", "n2", "n3", "n4", "n5"]);
    expect(out[0]).toMatchObject({
      text: [{ type: "text", text: "Friday 2026-10-30" }],
    });
    expect(out[1]).toMatchObject({
      text: [{ type: "text", text: "About Workflows", bold: true }],
      children: [
        { text: [{ type: "mention", kind: "page", id: "p", label: "Daily" }] },
      ],
    });
    expect(out[3]).toMatchObject({ title: "Week 2026-W44" });
  });

  test("leaves code verbatim", () => {
    const out = instantiateTemplateBlocks(template, context, ids());
    expect(out[2]).toMatchObject({ code: "{{date}}" });
  });

  test("lists inputs in first-seen order", () => {
    expect(
      templateInputNames("{{input:Title}} {{input:Topic}}", template),
    ).toEqual(["Title", "Topic", "Empty"]);
  });

  test("random trees keep their shape and get unique ids", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const blocks = genBlocks(rng(seed));
      const out = instantiateTemplateBlocks(blocks, context, ids(`s${seed}-`));
      const before = treeIds(blocks);
      const after = treeIds(out);
      expect(after.length).toBe(before.length);
      expect(new Set(after).size).toBe(after.length);
      expect(after.some((id) => before.includes(id))).toBe(false);
    }
  });
});
