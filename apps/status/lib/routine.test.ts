import { describe, expect, test } from "bun:test";
import { routineConfig, routineFireText } from "./routine";

describe("routine trigger", () => {
  const url =
    "https://api.anthropic.com/v1/claude_code/routines/trig_01KtSgLqUgJZpbbzfDMhJA7J/fire";
  test("needs both the URL and the token", () => {
    expect(routineConfig({ STATUS_ROUTINE_FIRE_URL: url })).toBeNull();
    expect(routineConfig({ STATUS_ROUTINE_FIRE_TOKEN: "t" })).toBeNull();
    expect(
      routineConfig({
        STATUS_ROUTINE_FIRE_URL: url,
        STATUS_ROUTINE_FIRE_TOKEN: "t",
      }),
    ).toEqual({ url, token: "t" });
  });
  test("the token is only ever sent to a routine fire endpoint", () => {
    for (const bad of [
      "https://evil.example/v1/claude_code/routines/trig_1/fire",
      "http://api.anthropic.com/v1/claude_code/routines/trig_1/fire",
      "https://api.anthropic.com/v1/messages",
      "not a url",
    ])
      expect(
        routineConfig({
          STATUS_ROUTINE_FIRE_URL: bad,
          STATUS_ROUTINE_FIRE_TOKEN: "t",
        }),
      ).toBeNull();
  });
  test("the payload names the issue and the incident and nothing else", () => {
    expect(
      routineFireText(
        "https://github.com/denizlg24/denizlg24.com/issues/7",
        "auto:1",
      ),
    ).toBe(
      "Escalated issue: https://github.com/denizlg24/denizlg24.com/issues/7\nStatus page incident: auto:1",
    );
  });
});
