import { describe, expect, it } from "vitest";

import { Camera, PAN_SPRING, stepAxis, ZOOM_SPRING } from "./camera.ts";
import { fillFor, frameAround, type View, stageFor, toScreen } from "./frame.ts";

const viewport = { width: 1440, height: 900 };
const scroll = { x: 0, y: 300 };
const frame = frameAround({ x: 500, y: 300, width: 320, height: 180 }, 0.2, 16 / 9);
const stage = stageFor(frame, viewport, fillFor(viewport), scroll);

/** A camera on a clock of the test's own: frames 1/60 s apart, run by `run`. */
function cameraOn({ still = false, pageHeight = 4000 } = {}) {
  let queued: ((now: number) => void) | null = null;
  let now = 0;
  const drawn: View[] = [];
  const camera = new Camera({
    stage,
    scroll,
    pageHeight,
    still,
    apply: (view) => drawn.push(view),
    frame: (callback) => ((queued = callback), 1),
    cancel: () => (queued = null),
  });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds && queued; t += 1 / 60) {
      const next = queued;
      queued = null;
      now += 1000 / 60;
      next(now);
    }
  };
  return { camera, drawn, run };
}

describe("a spring", () => {
  it("comes to rest on its target without going past it", () => {
    for (const spring of [ZOOM_SPRING, PAN_SPRING]) {
      let axis = { value: 0, velocity: 0, target: 1 };
      let most = 0;
      for (let k = 0; k < 120; k++) {
        axis = stepAxis(axis, spring, 1 / 60);
        most = Math.max(most, axis.value);
      }
      expect(most).toBeLessThanOrEqual(1 + 1e-6);
      expect(axis.value).toBeCloseTo(1, 3);
    }
  });

  it("is the same in big steps as in small ones", () => {
    let coarse = { value: 0, velocity: 0, target: 10 };
    let fine = { ...coarse };
    for (let k = 0; k < 30; k++) coarse = stepAxis(coarse, ZOOM_SPRING, 1 / 30);
    for (let k = 0; k < 120; k++) fine = stepAxis(fine, ZOOM_SPRING, 1 / 120);
    expect(coarse.value).toBeCloseTo(fine.value, 6);
  });
});

describe("the camera", () => {
  it("starts on the stage", () => {
    const { camera } = cameraOn();
    expect(camera.view).toEqual({ scale: stage.scale, tx: stage.tx, ty: stage.ty });
    expect(camera.settled).toBe(true);
  });

  it("closes in on a point, which stays where it is on screen, then draws back", async () => {
    const { camera, drawn, run } = cameraOn();
    const focus = { x: frame.x + 100, y: frame.y + scroll.y + 60 };
    const before = toScreen(stage, scroll, focus);
    camera.zoomTo(focus, 2);
    expect(camera.zoomed).toBe(true);
    run(0.2);
    // On its way: closer, the point still where it was.
    expect(camera.level).toBeGreaterThan(1.2);
    expect(camera.level).toBeLessThan(2);
    const midway = camera.toScreen(focus);
    expect(midway.x).toBeCloseTo(before.x, 6);
    expect(midway.y).toBeCloseTo(before.y, 6);
    run(2);
    expect(camera.settled).toBe(true);
    expect(camera.view.scale).toBeCloseTo(stage.scale * 2, 9);
    camera.zoomOut();
    run(2);
    expect(camera.view).toEqual({ scale: stage.scale, tx: stage.tx, ty: stage.ty });
    // Every frame drawn, each a little further than the last: no jumps.
    const scales = drawn.map((view) => view.scale);
    for (let k = 1; k < scales.length; k++) expect(Math.abs(scales[k] - scales[k - 1])).toBeLessThan(stage.scale * 0.15);
    await camera.rest();
  });

  it("glides over to another point while closed in, and starts afresh from the stage", () => {
    const { camera, run } = cameraOn();
    const a = { x: frame.x + 80, y: frame.y + scroll.y + 40 };
    const b = { x: frame.x + frame.width - 80, y: frame.y + scroll.y + frame.height - 40 };
    camera.zoomTo(a, 2);
    run(2);
    camera.zoomTo(b, 2);
    run(0.05);
    // Gliding: neither at a's view nor b's.
    const shown = camera.shown();
    run(2);
    const there = camera.shown();
    expect(there.x).toBeGreaterThan(shown.x);
    expect(camera.toScreen(b).x).toBeCloseTo(toScreen(stage, scroll, b).x, 3);
  });

  it("says what the view it's heading for shows", () => {
    const { camera, run } = cameraOn();
    const near = { x: frame.x + 100, y: frame.y + scroll.y + 60 };
    const far = { x: frame.x + frame.width - 20, y: frame.y + scroll.y + frame.height - 20 };
    expect(camera.shows(far)).toBe(true);
    camera.zoomTo(near, 2);
    expect(camera.shows(near, 0.1)).toBe(true);
    expect(camera.shows(far)).toBe(false);
    run(2);
  });

  it("pans down the page as far as it goes, and back up to the top", () => {
    const { camera, run } = cameraOn({ pageHeight: 2000 });
    expect(camera.canPan(-1)).toBe(true);
    camera.panBy(1e6);
    run(3);
    const shown = camera.shown();
    expect(shown.y + shown.height).toBeCloseTo(2000, 3);
    expect(camera.canPan(1)).toBe(false);
    camera.panBy(-1e6);
    run(3);
    expect(camera.shown().y).toBeCloseTo(0, 3);
  });

  it("moves at once when told to, or when still", () => {
    const { camera, drawn } = cameraOn({ still: true });
    camera.zoomTo({ x: frame.x + 50, y: frame.y + scroll.y + 50 }, 1.5);
    expect(camera.view.scale).toBeCloseTo(stage.scale * 1.5, 9);
    expect(drawn).toHaveLength(1);
    const moving = cameraOn();
    moving.camera.panBy(40, { now: true });
    expect(moving.camera.panned).toBe(40);
    expect(moving.drawn).toHaveLength(1);
  });

  it("knows the page under a point as it would be if it weren't closed in", () => {
    const { camera, run } = cameraOn();
    const q = { x: stage.screen.x + 200, y: stage.screen.y + 120 };
    const under = camera.under(q);
    camera.zoomTo(under, 2);
    run(2);
    // Closed in about it, the point under q is still the same.
    const now = camera.toPage(q);
    expect(now.x).toBeCloseTo(under.x, 6);
    expect(now.y).toBeCloseTo(under.y, 6);
  });
});
