import { describe, expect, it } from "vitest";

import { FILL, fillFor, frameAround, insetRect, MOST_SCALE, pixelSize, ROOM, stageFor, toPage, toScreen } from "./frame.ts";

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
