import { describe, expect, test } from "bun:test";
import { episodeLabel, rateLabel } from "./labels";
import { formatTime, resumeAt, spokenTime } from "./time";

describe("formatTime", () => {
  test("minutes and seconds under an hour", () => {
    expect(formatTime(0)).toBe("0:00");
    expect(formatTime(9.9)).toBe("0:09");
    expect(formatTime(754)).toBe("12:34");
  });

  test("hours once the value or the reference reaches one", () => {
    expect(formatTime(3725)).toBe("1:02:05");
    expect(formatTime(65, 4000)).toBe("0:01:05");
  });

  test("garbage reads as zero", () => {
    expect(formatTime(Number.NaN)).toBe("0:00");
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe("0:00");
    expect(formatTime(-4)).toBe("0:00");
  });
});

describe("spokenTime", () => {
  test("names each unit", () => {
    expect(spokenTime(0)).toBe("0 seconds");
    expect(spokenTime(61)).toBe("1 minute 1 second");
    expect(spokenTime(7200)).toBe("2 hours");
  });
});

describe("resumeAt", () => {
  test("skips the first seconds and the credits", () => {
    expect(resumeAt(3, 3600)).toBe(0);
    expect(resumeAt(3590, 3600)).toBe(0);
    expect(resumeAt(1200, 3600)).toBe(1200);
  });

  test("trusts the position when the duration is unknown", () => {
    expect(resumeAt(1200, Number.NaN)).toBe(1200);
  });
});

describe("labels", () => {
  test("rates", () => {
    expect(rateLabel(1)).toBe("Normal");
    expect(rateLabel(1.5)).toBe("1.5×");
  });

  test("episodes", () => {
    expect(episodeLabel({ season: 2, episode: 3, title: "Pilot" })).toBe(
      "S2 E3: Pilot",
    );
    expect(episodeLabel({ season: null, episode: 4, title: null })).toBe("E4");
    expect(episodeLabel({ season: null, episode: null, title: " " })).toBe(
      "Next episode",
    );
  });
});
