import { describe, expect, it } from "vitest";

import { easeInOut, measure, pointAt, reachTime } from "./path.ts";

describe("paths", () => {
  it("measure a straight line by its length, and read points by distance along it", () => {
    const path = measure([{ at: { x: 0, y: 0 } }, { at: { x: 300, y: 400 } }]);
    expect(path.total).toBeCloseTo(500);
    expect(pointAt(path, 250).x).toBeCloseTo(150);
    expect(pointAt(path, 250).y).toBeCloseTo(200);
    expect(pointAt(path, 9999)).toEqual({ x: 300, y: 400 });
  });

  it("follow handles: a quarter circle drawn with handles is a quarter of its circumference", () => {
    const k = 0.5523 * 100;
    const path = measure([
      { at: { x: 100, y: 0 }, out: { x: 0, y: k } },
      { at: { x: 0, y: 100 }, in: { x: k, y: 0 } },
    ]);
    expect(path.total).toBeCloseTo((Math.PI * 100) / 2, 0);
    // Halfway along by length is at 45°, on the circle.
    const half = pointAt(path, path.total / 2);
    expect(Math.hypot(half.x, half.y)).toBeCloseTo(100, 0);
    expect(half.x).toBeCloseTo(half.y, 0);
  });

  it("know where each node falls along the way", () => {
    const path = measure([{ at: { x: 0, y: 0 } }, { at: { x: 100, y: 0 } }, { at: { x: 100, y: 50 } }]);
    expect(path.nodeAt).toEqual([0, 100, 150]);
  });
});

describe("timing", () => {
  it("takes longer to reach far and small targets than near and large ones", () => {
    expect(reachTime(800, 16)).toBeGreaterThan(reachTime(100, 16));
    expect(reachTime(400, 12)).toBeGreaterThan(reachTime(400, 120));
    expect(reachTime(0)).toBeCloseTo(0.18);
  });

  it("eases in and out, from 0 to 1", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(0.1)).toBeLessThan(0.1);
  });
});
