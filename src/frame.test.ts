import { describe, expect, it } from "vitest";

import { cameraView, FILL, fillFor, frameAround, insetRect, MOST_SCALE, panRange, pixelSize, ROOM, shownBy, stageFor, toPage, toScreen } from "./frame.ts";

describe("frameAround", () => {
  it("grows the target by its padding and keeps its centre", () => {
    const frame = frameAround({ x: 100, y: 50, width: 40, height: 20 }, 0.25, null);
    expect(frame).toEqual({ x: 90, y: 45, width: 60, height: 30 });
  });

  it("widens a tall target to a wide shape, and heightens a wide one to a tall shape, never cropping", () => {
    const wide = frameAround({ x: 0, y: 0, width: 20, height: 40 }, 0, 16 / 9);
    expect(wide.height).toBe(40);
    expect(wide.width).toBeCloseTo(40 * (16 / 9));
    const tall = frameAround({ x: 0, y: 0, width: 100, height: 10 }, 0, 4 / 5);
    expect(tall.width).toBe(100);
    expect(tall.height).toBeCloseTo(125);
  });
});

describe("stageFor", () => {
  const viewport = { width: 1400, height: 800 };

  it("enlarges a small frame until it fills the viewport in its tighter direction, centred", () => {
    const stage = stageFor({ x: 600, y: 100, width: 160, height: 90 }, viewport, 0.8);
    expect(stage.scale).toBeCloseTo(Math.min((1400 * 0.8) / 160, (800 * 0.8) / 90));
    expect(stage.screen.x + stage.screen.width / 2).toBeCloseTo(700);
    expect(stage.screen.y + stage.screen.height / 2).toBeCloseTo(400);
    // The frame's centre, scaled about the page's top left and moved, lands in the middle.
    expect((600 + 80) * stage.scale + stage.tx).toBeCloseTo(700);
    expect((100 + 45) * stage.scale + stage.ty).toBeCloseTo(400);
  });

  it("counts the scroll: the page's top left is the document's", () => {
    const stage = stageFor({ x: 600, y: 100, width: 160, height: 90 }, viewport, 0.8, { x: 0, y: 500 });
    expect((100 + 500 + 45) * stage.scale + stage.ty - 500).toBeCloseTo(400);
  });

  it("enlarges no more than MOST_SCALE, however small the frame", () => {
    expect(stageFor({ x: 0, y: 0, width: 2, height: 1 }, viewport, 0.9).scale).toBe(MOST_SCALE);
  });

  it("shrinks a frame bigger than the viewport", () => {
    expect(stageFor({ x: 0, y: 0, width: 2800, height: 400 }, viewport, 0.9).scale).toBeLessThan(1);
  });
});

describe("toScreen and toPage", () => {
  it("draw the frame's centre in the middle of the window, scrolled or not, and undo each other", () => {
    const frame = { x: 600, y: 100, width: 160, height: 90 };
    const scroll = { x: 0, y: 500 };
    const stage = stageFor(frame, { width: 1400, height: 800 }, 0.8, scroll);
    // The frame was measured on screen; in the page it's 500 lower.
    const centre = { x: 680, y: 145 + 500 };
    const drawn = toScreen(stage, scroll, centre);
    expect(drawn.x).toBeCloseTo(700);
    expect(drawn.y).toBeCloseTo(400);
    const back = toPage(stage, scroll, { x: 123, y: 456 });
    const again = toScreen(stage, scroll, back);
    expect(again.x).toBeCloseTo(123);
    expect(again.y).toBeCloseTo(456);
  });
});

describe("fillFor", () => {
  it("fills FILL of a tall enough window, and leaves ROOM above and below in a short one", () => {
    expect(fillFor({ width: 1400, height: 900 })).toBe(FILL);
    const short = { width: 1400, height: 500 };
    const stage = stageFor({ x: 0, y: 0, width: 160, height: 90 }, short, fillFor(short));
    expect(stage.screen.y).toBeCloseTo(ROOM);
  });
});

describe("pixelSize", () => {
  it("is the frame at the screen's density, in even pixels", () => {
    expect(pixelSize({ x: 0, y: 0, width: 1201.3, height: 675.7 }, 2)).toEqual({ width: 2402, height: 1352 });
  });
});

describe("insetRect", () => {
  it("keeps the take's shape and centres it inside the margin", () => {
    const inner = insetRect({ width: 1920, height: 1080 }, 0.1);
    expect(inner.width / inner.height).toBeCloseTo(1920 / 1080);
    expect(inner.y).toBeCloseTo(108);
    expect(inner.x + inner.width / 2).toBeCloseTo(960);
  });
});

describe("the camera", () => {
  const viewport = { width: 1000, height: 800 };
  const frame = { x: 100, y: 100, width: 400, height: 300 };
  const scroll = { x: 0, y: 50 };
  const stage = stageFor(frame, viewport, 0.8, scroll);
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    expect(a.x).toBeCloseTo(b.x, 6);
    expect(a.y).toBeCloseTo(b.y, 6);
  };

  it("is the stage itself at no zoom and no pan", () => {
    const view = cameraView(stage, scroll, 1, { x: 0, y: 0 }, 0);
    expect(view).toEqual({ scale: stage.scale, tx: stage.tx, ty: stage.ty });
    const shown = shownBy(view, scroll, stage.screen);
    near(shown, { x: frame.x, y: frame.y + scroll.y });
    expect(shown.width).toBeCloseTo(frame.width, 6);
  });

  it("zooms toward a point, keeping it where it is on screen", () => {
    const focus = { x: frame.x + 200, y: frame.y + scroll.y + 150 };
    const view = cameraView(stage, scroll, 2, focus, 0);
    expect(view.scale).toBeCloseTo(stage.scale * 2, 9);
    near(toScreen(view, scroll, focus), toScreen(stage, scroll, focus));
  });

  it("never shows past what the stage showed, however near the edge it zooms", () => {
    const corner = { x: frame.x + 5, y: frame.y + scroll.y + 5 };
    const view = cameraView(stage, scroll, 2, corner, 0);
    const shown = shownBy(view, scroll, stage.screen);
    const outer = shownBy(stage, scroll, stage.screen);
    expect(shown.x).toBeGreaterThanOrEqual(outer.x - 1e-9);
    expect(shown.y).toBeGreaterThanOrEqual(outer.y - 1e-9);
    expect(shown.width).toBeCloseTo(outer.width / 2, 6);
  });

  it("pans down the page as far as the page goes, and shows what's further down", () => {
    const range = panRange(stage, scroll, 2000);
    const shownAtStart = shownBy(stage, scroll, stage.screen);
    expect(range[0]).toBeCloseTo(-shownAtStart.y, 6);
    expect(range[1]).toBeCloseTo(2000 - (shownAtStart.y + shownAtStart.height), 6);
    const view = cameraView(stage, scroll, 1, { x: 0, y: 0 }, 120, range);
    expect(shownBy(view, scroll, stage.screen).y).toBeCloseTo(shownAtStart.y + 120, 6);
    const past = cameraView(stage, scroll, 1, { x: 0, y: 0 }, 1e6, range);
    expect(shownBy(past, scroll, stage.screen).y + shownAtStart.height).toBeCloseTo(2000, 6);
    expect(panRange(stage, scroll, 10)).toEqual([expect.any(Number), 0]);
  });

  it("zooms within where it's panned to", () => {
    const range = panRange(stage, scroll, 2000);
    const view = cameraView(stage, scroll, 1.5, { x: frame.x + 200, y: frame.y + scroll.y + 400 }, 300, range);
    const panned = shownBy(cameraView(stage, scroll, 1, { x: 0, y: 0 }, 300, range), scroll, stage.screen);
    const shown = shownBy(view, scroll, stage.screen);
    expect(shown.y).toBeGreaterThanOrEqual(panned.y - 1e-9);
    expect(shown.y + shown.height).toBeLessThanOrEqual(panned.y + panned.height + 1e-9);
  });
});
