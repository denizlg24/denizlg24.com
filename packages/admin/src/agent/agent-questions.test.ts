import { describe, expect, test } from "bun:test";
import type { AgentQuestion } from "@repo/schemas";
import {
  answersOf,
  buildQuestionAnswers,
  emptyDraft,
  isAnswered,
  questionsOf,
  toggleOption,
} from "./agent-questions";

const scope: AgentQuestion = {
  id: "scope",
  question: "Which notes?",
  options: [{ label: "All" }, { label: "Tagged" }, { label: "Recent" }],
};
const multi: AgentQuestion = { ...scope, id: "multi", multiSelect: true };

describe("questionsOf", () => {
  test("reads a well-formed call and refuses a malformed one", () => {
    expect(questionsOf({ questions: [scope] })).toEqual([scope]);
    expect(questionsOf({ questions: [{ id: "x", question: "?" }] })).toBeNull();
    expect(questionsOf(undefined)).toBeNull();
  });
});

describe("toggleOption", () => {
  test("single select replaces and toggles off", () => {
    let draft = toggleOption(scope, emptyDraft(), "All");
    draft = toggleOption(scope, draft, "Tagged");
    expect(draft.selected).toEqual(["Tagged"]);
    expect(toggleOption(scope, draft, "Tagged").selected).toEqual([]);
  });

  test("multi select toggles each", () => {
    let draft = toggleOption(multi, emptyDraft(), "Recent");
    draft = toggleOption(multi, draft, "All");
    expect(draft.selected).toEqual(["Recent", "All"]);
    expect(toggleOption(multi, draft, "Recent").selected).toEqual(["All"]);
  });
});

describe("buildQuestionAnswers", () => {
  test("keeps the offered order and trims free text", () => {
    const output = buildQuestionAnswers(
      [multi, scope],
      new Map([
        ["multi", { selected: ["Recent", "All"], other: "" }],
        ["scope", { selected: [], other: "  only drafts " }],
      ]),
    );
    expect(output).toEqual({
      answers: [
        { id: "multi", selected: ["All", "Recent"] },
        { id: "scope", selected: [], other: "only drafts" },
      ],
    });
    expect(answersOf(output)).toEqual(
      "answers" in output ? output.answers : [],
    );
  });

  test("a question with neither choice nor text is unanswered", () => {
    expect(isAnswered(undefined)).toBe(false);
    expect(isAnswered({ selected: [], other: "  " })).toBe(false);
    expect(isAnswered({ selected: [], other: "x" })).toBe(true);
  });
});

test("answersOf reads a skip", () => {
  expect(answersOf({ dismissed: true })).toBe("dismissed");
  expect(answersOf("nope")).toBeNull();
});

describe("questionsOf edge cases", () => {
  test("refuses duplicate ids, which would share one draft", () => {
    const question = {
      id: "scope",
      question: "Which?",
      options: [{ label: "A" }, { label: "B" }],
    };
    expect(questionsOf({ questions: [question, question] })).toBeNull();
  });

  test("an id like __proto__ is an ordinary key", () => {
    const question = {
      id: "__proto__",
      question: "Which?",
      options: [{ label: "A" }, { label: "B" }],
    };
    const questions = questionsOf({ questions: [question] });
    expect(questions).not.toBeNull();
    expect(buildQuestionAnswers(questions ?? [], new Map())).toEqual({
      answers: [{ id: "__proto__", selected: [] }],
    });
  });
});
