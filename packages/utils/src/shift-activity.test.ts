import { describe, expect, test } from "bun:test";
import { shiftActivityState } from "./shift-activity";

const at = (time: string) => new Date(`2026-10-08T${time}:00Z`);

describe("shiftActivityState", () => {
  test("counts worked time up from the shift start", () => {
    const state = shiftActivityState(
      { id: "s", start: at("08:00"), breaks: [] },
      false,
      at("10:00"),
    );
    expect(state).toEqual({
      sessionId: "s",
      status: "working",
      workedFrom: at("08:00").getTime() / 1000,
      breakFrom: null,
      workedSeconds: 7200,
    });
  });

  test("moves the timer anchor past closed unpaid breaks", () => {
    const state = shiftActivityState(
      {
        id: "s",
        start: at("08:00"),
        breaks: [{ start: at("09:00"), end: at("09:30") }],
      },
      false,
      at("10:00"),
    );
    expect(state?.workedFrom).toBe(at("08:30").getTime() / 1000);
    expect(state?.workedSeconds).toBe(5400);
  });

  test("freezes worked time during an open break", () => {
    const state = shiftActivityState(
      { id: "s", start: at("08:00"), breaks: [{ start: at("09:00") }] },
      false,
      at("09:20"),
    );
    expect(state?.status).toBe("break");
    expect(state?.breakFrom).toBe(at("09:00").getTime() / 1000);
    expect(state?.workedSeconds).toBe(3600);
  });

  test("paid breaks keep counting", () => {
    const state = shiftActivityState(
      { id: "s", start: at("08:00"), breaks: [{ start: at("09:00") }] },
      true,
      at("09:20"),
    );
    expect(state?.workedSeconds).toBe(4800);
  });

  test("an ended shift has no activity", () => {
    expect(
      shiftActivityState(
        { id: "s", start: at("08:00"), end: at("09:00"), breaks: [] },
        false,
        at("10:00"),
      ),
    ).toBeNull();
  });
});
