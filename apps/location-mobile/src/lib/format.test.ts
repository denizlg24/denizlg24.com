import { describe, expect, test } from "bun:test";
import {
  accuracy,
  ago,
  area,
  coordinates,
  distance,
  duration,
  elapsed,
} from "./format";

describe("format", () => {
  test("durations read in hours past the hour", () => {
    expect(duration(42.4)).toBe("42 min");
    expect(duration(60)).toBe("1 h");
    expect(duration(135)).toBe("2 h 15 min");
  });

  test("accuracy switches to km for coarse fixes", () => {
    expect(accuracy(12.4)).toBe("±12 m");
    expect(accuracy(1_660)).toBe("±1.7 km");
  });

  test("coordinates keep five decimals (~1 m)", () => {
    expect(coordinates(55.676098, 12.568337)).toBe("55.67610, 12.56834");
  });

  test("ago buckets", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(ago("2026-10-15T11:59:30Z", now)).toBe("now");
    expect(ago("2026-10-15T11:56:00Z", now)).toBe("4 min ago");
    expect(ago("2026-10-15T09:00:00Z", now)).toBe("3 h ago");
    expect(ago("2026-10-12T12:00:00Z", now)).toBe("3 d ago");
  });

  test("distances switch to kilometres at one", () => {
    expect(distance(849.6)).toBe("850 m");
    expect(distance(3_420)).toBe("3.4 km");
  });

  test("areas switch to square kilometres at a tenth", () => {
    expect(area(8_400)).toBe("8,400 m²");
    expect(area(1_240_000)).toBe("1.24 km²");
  });

  test("elapsed drops the hour until there is one", () => {
    expect(elapsed(12 * 60_000 + 4_000)).toBe("12:04");
    expect(elapsed(((60 + 5) * 60 + 9) * 1_000)).toBe("1:05:09");
  });
});
