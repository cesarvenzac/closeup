import { describe, expect, it } from "vitest";

import { FILM_SECONDS, filmSettings, restingScript } from "./film.ts";
import { moveDuration } from "./script.ts";
import { DEFAULTS } from "./settings.ts";

describe("filming without the toolbar", () => {
  it("makes a take as asked: its shape, room, cursor and camera, a frame at a time, silent, no countdown", () => {
    expect(filmSettings({})).toEqual({ ...DEFAULTS, mode: "video", pick: "element", padding: 0, background: "none", moves: "script", countdown: 0, clicks: false, tabAudio: false, render: true });
    expect(filmSettings({ shape: "9:16", cursor: false, padding: 0.1, zoom: 2 })).toMatchObject({ shape: "9:16", cursor: false, padding: 0.1, zoom: 2, render: true });
  });

  it("with no script, rests where the element is for as long as asked, never less than nothing", () => {
    const script = restingScript({ x: 320, y: 240 }, 3);
    expect(script).toEqual({ version: 1, start: { x: 320, y: 240 }, steps: [{ to: { x: 320, y: 240 }, action: "move", wait: 3 }] });
    // A step to the point it's at takes no time: the take is the rest alone, with Closeup's lead and linger.
    expect(moveDuration(script.steps[0]!, 0, 48)).toBe(0);
    expect(restingScript({ x: 0, y: 0 }, -1).steps[0]!.wait).toBe(0);
    expect(FILM_SECONDS).toBe(5);
  });
});
