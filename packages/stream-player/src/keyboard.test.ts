import { describe, expect, test } from "bun:test";
import { nearestInDirection } from "./focus-nav";
import { resolveTap } from "./gestures";
import { type KeyContext, resolveKey } from "./keyboard";

const hidden: KeyContext = {
  chromeVisible: false,
  menuOpen: false,
  target: "control",
};
const onButton: KeyContext = { ...hidden, chromeVisible: true };
const onNothing: KeyContext = { ...onButton, target: "none" };

const key = (k: string, ctx: KeyContext) => resolveKey({ key: k }, ctx);

describe("resolveKey", () => {
  test("shortcuts", () => {
    expect(key(" ", onButton)).toEqual({ type: "toggle-play" });
    expect(key("K", onButton)).toEqual({ type: "toggle-play" });
    expect(key("j", onButton)).toEqual({ type: "seek-by", seconds: -10 });
    expect(key("l", onButton)).toEqual({ type: "seek-by", seconds: 10 });
    expect(key("f", onButton)).toEqual({ type: "toggle-fullscreen" });
    expect(key("m", onButton)).toEqual({ type: "toggle-mute" });
    expect(key("c", onButton)).toEqual({ type: "toggle-captions" });
    expect(key("5", onButton)).toEqual({
      type: "seek-fraction",
      fraction: 0.5,
    });
  });

  test("arrows seek and change volume while the chrome is hidden", () => {
    expect(key("ArrowLeft", hidden)).toEqual({ type: "seek-by", seconds: -10 });
    expect(key("ArrowRight", hidden)).toEqual({ type: "seek-by", seconds: 10 });
    expect(key("ArrowUp", hidden)).toEqual({ type: "volume-by", delta: 0.1 });
    expect(key("ArrowDown", hidden)).toEqual({
      type: "volume-by",
      delta: -0.1,
    });
  });

  test("arrows move focus between visible controls", () => {
    expect(key("ArrowLeft", onButton)).toEqual({
      type: "focus",
      direction: "left",
    });
    expect(key("ArrowUp", onButton)).toEqual({
      type: "focus",
      direction: "up",
    });
  });

  test("sliders keep their own axis and hand the other to focus", () => {
    const seek = { ...onButton, target: "seek" as const };
    const volume = { ...onButton, target: "volume" as const };
    expect(key("ArrowRight", seek)).toEqual({ type: "seek-by", seconds: 10 });
    expect(key("ArrowDown", seek)).toEqual({
      type: "focus",
      direction: "down",
    });
    expect(key("ArrowLeft", volume)).toEqual({
      type: "volume-by",
      delta: -0.1,
    });
    expect(key("Home", seek)).toEqual({ type: "seek-edge", edge: "start" });
  });

  test("arrows seek when nothing in the chrome has focus", () => {
    expect(key("ArrowLeft", onNothing)).toEqual({
      type: "seek-by",
      seconds: -10,
    });
  });

  test("Enter activates a visible control and only reveals a hidden one", () => {
    expect(key("Enter", onButton)).toBeNull();
    expect(key("Enter", hidden)).toEqual({ type: "reveal" });
    expect(key("Enter", onNothing)).toEqual({ type: "toggle-play" });
  });

  test("Escape closes a menu before going back", () => {
    const menu = { ...onButton, menuOpen: true };
    expect(key("Escape", menu)).toEqual({ type: "close-menu" });
    expect(key("Escape", onButton)).toEqual({ type: "back" });
    expect(key("GoBack", onButton)).toEqual({ type: "back" });
    expect(key("ArrowDown", menu)).toBeNull();
    expect(key(" ", menu)).toBeNull();
  });

  test("leaves modified keys and unknown keys alone", () => {
    expect(resolveKey({ key: "f", metaKey: true }, onButton)).toBeNull();
    expect(resolveKey({ key: "l", ctrlKey: true }, onButton)).toBeNull();
    expect(key("Tab", onButton)).toBeNull();
    expect(key("x", onButton)).toBeNull();
  });

  test("remote media keys", () => {
    expect(key("MediaPlayPause", hidden)).toEqual({ type: "toggle-play" });
    expect(key("MediaRewind", hidden)).toEqual({
      type: "seek-by",
      seconds: -10,
    });
  });
});

describe("nearestInDirection", () => {
  const box = (left: number, top: number, width = 40, height = 40) => ({
    left,
    top,
    width,
    height,
  });
  const play = box(20, 600);
  const rewind = box(80, 600);
  const seekBar = box(20, 540, 1200, 20);
  const back = box(20, 20);
  const fullscreen = box(1200, 600);

  test("same row, nearest first", () => {
    expect(nearestInDirection(play, [fullscreen, rewind], "right")).toBe(1);
  });

  test("a wide overlapping target beats an aligned one further away", () => {
    expect(nearestInDirection(fullscreen, [back, seekBar], "up")).toBe(1);
    expect(nearestInDirection(play, [back, seekBar], "up")).toBe(1);
  });

  test("nothing in that direction", () => {
    expect(nearestInDirection(play, [rewind, seekBar], "down")).toBe(-1);
    expect(nearestInDirection(play, [], "left")).toBe(-1);
  });
});

describe("resolveTap", () => {
  const width = 900;
  test("second tap on the same side seeks", () => {
    expect(resolveTap({ x: 50, at: 0 }, { x: 60, at: 200 }, width)).toBe(
      "seek-back",
    );
    expect(resolveTap({ x: 850, at: 0 }, { x: 840, at: 250 }, width)).toBe(
      "seek-forward",
    );
  });

  test("slow taps, the centre and different sides are single taps", () => {
    expect(resolveTap(null, { x: 50, at: 0 }, width)).toBe("single");
    expect(resolveTap({ x: 50, at: 0 }, { x: 50, at: 400 }, width)).toBe(
      "single",
    );
    expect(resolveTap({ x: 450, at: 0 }, { x: 450, at: 100 }, width)).toBe(
      "single",
    );
    expect(resolveTap({ x: 50, at: 0 }, { x: 850, at: 100 }, width)).toBe(
      "single",
    );
  });
});
