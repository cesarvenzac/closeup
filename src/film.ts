/**
 * Filming without the toolbar: an element of the page filmed as a scripted take is, a frame at a
 * time where the browser can (Render), in the shape asked, with or without the drawn cursor, and
 * handed back as the finished take. For a page of your own that makes its films itself: a clip
 * laid out in the page and filmed, a product's screen played through a script. Chrome still asks to
 * share the tab, so it's called from a press.
 */

import type { Take } from "./actions.ts";
import type { Shape } from "./frame.ts";
import type { Point } from "./path.ts";
import type { Script } from "./script.ts";
import { DEFAULTS, type Settings } from "./settings.ts";
import { startVideo, toRect } from "./take.ts";

export type FilmOptions = {
  /** Where the cursor goes and what it does there. Without one, the element is filmed as it moves on its own for `seconds`. */
  script?: Script;
  /** Without a script: how long the take lasts, in seconds (5 unless said; with a script, the script's own length). */
  seconds?: number;
  /** The take's shape: "16:9" unless said; "9:16" for a phone's screen. */
  shape?: Shape;
  /** Whether the cursor is drawn: true unless said. Hidden, a script's moves, clicks and typing still reach the page. */
  cursor?: boolean;
  /** Room round the element, a share of its size on each side: none unless said. */
  padding?: number;
  /** How close the camera comes on a script's clicks and typing: 1 (not at all), 1.5 or 2. */
  zoom?: number;
  /** Stops the take where it is: what's made so far is the take. */
  signal?: AbortSignal;
};

/** How long a take with no script lasts unless said, in seconds. */
export const FILM_SECONDS = 5;

/** What a film is made with: Closeup's own settings as asked, a frame at a time, silent, with no countdown. */
export function filmSettings(options: FilmOptions): Settings {
  return {
    ...DEFAULTS,
    mode: "video",
    pick: "element",
    shape: options.shape ?? DEFAULTS.shape,
    padding: options.padding ?? 0,
    background: "none",
    cursor: options.cursor ?? true,
    moves: "script",
    zoom: options.zoom ?? 1,
    countdown: 0,
    clicks: false,
    tabAudio: false,
    render: true,
  };
}

/** A script that only rests at a point of the page (as laid out) for `seconds`: what a film with no script plays. */
export const restingScript = (point: Point, seconds: number): Script => ({ version: 1, start: point, steps: [{ to: point, action: "move", wait: Math.max(0, seconds) }] });

/**
 * Films `element` and hands back the take: its file (a regular MP4), its size and length. Call it
 * from a press (Chrome asks to share the tab); nothing of Closeup's shows on the page meanwhile,
 * but the drawn cursor where asked, and the page is put back as it was once it's done. Throws
 * where the tab isn't shared or the browser can't film (`supportsCapture`).
 */
export async function film(element: Element, options: FilmOptions = {}): Promise<Take> {
  if (!element.isConnected) throw new Error("the element to film isn't on the page");
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException("The take was stopped.", "AbortError");
  const settings = filmSettings(options);
  const rect = toRect(element.getBoundingClientRect());
  const centre = { x: rect.x + rect.width / 2 + scrollX, y: rect.y + rect.height / 2 + scrollY };
  const script = options.script ?? restingScript(centre, options.seconds ?? FILM_SECONDS);
  // What Closeup draws over the page (the cursor, the frame it crops to), outside <body>, which the stage scales.
  const host = document.createElement("div");
  host.setAttribute("data-closeup", "");
  host.setAttribute("style", "position:fixed;inset:0;pointer-events:none;z-index:2147483640;");
  document.documentElement.append(host);
  try {
    const running = await startVideo({ element, rect }, settings, { host, ignore: () => false }, null, script, undefined, settings.cursor);
    return await new Promise<Take>((resolve, reject) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        running.stop().then(resolve, reject);
      };
      options.signal?.addEventListener("abort", stop, { once: true });
      void (running.finished ?? Promise.resolve()).then(stop);
    });
  } finally {
    host.remove();
  }
}
