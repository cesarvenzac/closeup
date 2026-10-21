import { describe, expect, it } from "vitest";

import { actionDuration, autoHandles, minimumJerk, moveDuration, parseScript, PRESS, type Script, SCROLL_MOST, scrollDuration, typingDelays } from "./script.ts";

describe("minimumJerk", () => {
  it("starts and ends at rest, halfway at half time, and never runs backwards", () => {
    expect(minimumJerk(0)).toBe(0);
    expect(minimumJerk(1)).toBe(1);
    expect(minimumJerk(0.5)).toBeCloseTo(0.5);
    // Slow at both ends: the first and last tenths cover little ground.
    expect(minimumJerk(0.1)).toBeLessThan(0.02);
    expect(1 - minimumJerk(0.9)).toBeLessThan(0.02);
    for (let t = 0; t < 1; t += 0.01) expect(minimumJerk(t + 0.01)).toBeGreaterThanOrEqual(minimumJerk(t));
  });
});

describe("autoHandles", () => {
  it("bows a move to the left of its direction, by the bend, a third along each end", () => {
    // Moving right on screen (y down), left is up: negative y.
    const { out, in: into } = autoHandles({ x: 0, y: 0 }, { x: 300, y: 0 }, 0.1);
    expect(out).toEqual({ x: 100, y: -30 });
    expect(into).toEqual({ x: -100, y: -30 });
  });

  it("is a straight line without a bend", () => {
    const { out, in: into } = autoHandles({ x: 0, y: 0 }, { x: 0, y: 90 }, 0);
    expect(out.x).toBeCloseTo(0);
    expect(into.x).toBeCloseTo(0);
  });
});

describe("moveDuration", () => {
  it("takes a hand's pace: longer for farther, shorter for bigger targets, as given when given", () => {
    expect(moveDuration({}, 800, 24)).toBeGreaterThan(moveDuration({}, 200, 24));
    expect(moveDuration({}, 800, 200)).toBeLessThan(moveDuration({}, 800, 24));
    expect(moveDuration({ duration: 2 }, 800, 24)).toBe(2);
    expect(moveDuration({}, 0, 24)).toBe(0);
  });
});

describe("typingDelays", () => {
  it("is uneven but the same every time, slower at spaces", () => {
    const delays = typingDelays("hello there");
    expect(delays).toEqual(typingDelays("hello there"));
    expect(new Set(delays.map((d) => d.toFixed(3))).size).toBeGreaterThan(5);
    expect(delays[5]).toBeGreaterThanOrEqual(0.11);
    for (const d of delays) expect(d).toBeGreaterThan(0.05);
  });

  it("counts into a step's action time", () => {
    expect(actionDuration({ to: { x: 0, y: 0 }, action: "click", wait: 0 })).toBe(PRESS);
    expect(actionDuration({ to: { x: 0, y: 0 }, action: "type", text: "hi", wait: 0 })).toBeGreaterThan(PRESS + 0.1);
    expect(actionDuration({ to: { x: 0, y: 0 }, action: "move", wait: 1 })).toBe(0);
    expect(actionDuration({ to: { x: 0, y: 0 }, action: "click", hover: 1, wait: 0 })).toBe(1 + PRESS);
    expect(actionDuration({ to: { x: 0, y: 0 }, action: "scroll", scroll: -900, hover: 0.5, wait: 0 })).toBe(0.5 + scrollDuration(900));
  });
});

describe("scrollDuration", () => {
  it("takes longer the farther it goes, either way, within reason", () => {
    expect(scrollDuration(0)).toBe(0);
    expect(scrollDuration(300)).toBe(scrollDuration(-300));
    expect(scrollDuration(900)).toBeGreaterThan(scrollDuration(300));
    expect(scrollDuration(300)).toBeGreaterThan(0.8);
    expect(scrollDuration(1e6)).toBe(6);
  });
});

describe("parseScript", () => {
  const script: Script = {
    version: 1,
    start: { x: 10, y: 20 },
    out: { x: 5, y: -5 },
    steps: [
      { to: { x: 100, y: 40, on: { selector: "button.pet", u: 0.5, v: 0.5 } }, in: { x: -20, y: 0 }, action: "click", hover: 0.8, wait: 0.4 },
      { to: { x: 200, y: 40 }, action: "type", text: "Hi", duration: 0.6, wait: 0 },
    ],
  };

  it("reads back what was saved", () => {
    expect(parseScript(JSON.parse(JSON.stringify(script)))).toEqual(script);
  });

  it("refuses what isn't a script, and drops what it doesn't know", () => {
    expect(parseScript(null)).toBeNull();
    expect(parseScript({ version: 3, start: { x: 0, y: 0 }, steps: [] })).toBeNull();
    expect(parseScript({ version: 1, start: { x: "a", y: 0 }, steps: [] })).toBeNull();
    expect(parseScript({ version: 1, start: { x: 0, y: 0 }, steps: [{ to: {} }] })).toBeNull();
    const loose = parseScript({ version: 1, start: { x: 0, y: 0, on: { selector: "", u: 0, v: 0 } }, steps: [{ to: { x: 1, y: 2 }, action: "dance", wait: -3, extra: true }] });
    expect(loose).toEqual({ version: 1, start: { x: 0, y: 0 }, steps: [{ to: { x: 1, y: 2 }, action: "move", wait: 0 }] });
  });

  it("reads version 2's scrolling, and writes a script that doesn't scroll as version 1", () => {
    const scrolling: Script = {
      version: 2,
      start: { x: 0, y: 0 },
      steps: [
        { to: { x: 10, y: 10 }, action: "scroll", scroll: 400, hover: 0.2, wait: 0.5 },
        { to: { x: 20, y: 30 }, action: "click", wait: 0 },
      ],
    };
    expect(parseScript(JSON.parse(JSON.stringify(scrolling)))).toEqual(scrolling);
    expect(parseScript({ ...scrolling, steps: [scrolling.steps[1]] })?.version).toBe(1);
    // Scrolling isn't version 1's: there it's a move.
    expect(parseScript({ ...scrolling, version: 1 })?.steps[0]).toEqual({ to: { x: 10, y: 10 }, action: "move", wait: 0.5 });
    const far = parseScript({ version: 2, start: { x: 0, y: 0 }, steps: [{ to: { x: 0, y: 0 }, action: "scroll", scroll: -1e9, wait: 0 }] });
    expect(far?.steps[0].scroll).toBe(-SCROLL_MOST);
    expect(parseScript({ version: 2, start: { x: 0, y: 0 }, steps: [{ to: { x: 0, y: 0 }, action: "scroll", wait: 0 }] })?.steps[0].scroll).toBe(0);
  });
});
