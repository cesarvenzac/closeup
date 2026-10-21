/**
 * Plays a script: the drawn cursor travels each curve at a hand's pace, then clicks, types,
 * scrolls or just rests, and the page is told about every move and press as if a mouse made
 * them (`pointer.ts`). Each target is found when its move begins, on its element if that's
 * still there, so a scene survives a layout that shifted since it was drawn. The camera may
 * close in on what's clicked or typed into: the cursor travels the page, not the screen, so it
 * stays on what it's over while the view changes, except while it scrolls (a hand on a wheel
 * keeps still while the page moves under it).
 */

import type { Camera } from "./camera.ts";
import type { DrawnCursor } from "./cursor.ts";
import { measure, type PathNode, type Point, pointAt } from "./path.ts";
import type { SyntheticPointer } from "./pointer.ts";
import { actionDuration, autoHandles, LEAD, minimumJerk, moveDuration, PRESS, type Script, scrollDuration, type Step, TAIL, type Target, typingDelays } from "./script.ts";
import { scrollerFor } from "./wheel.ts";

/** A target found on screen, and the size of what it's on (for the pace of reaching it). */
export type Place = Point & { size: number };

export type PlayOptions = {
  cursor: DrawnCursor;
  pointer: SyntheticPointer;
  /** The camera over the stage: where a point of the page is on screen now, closing in and panning. */
  camera: Camera;
  /** How close the camera comes to what's clicked or typed into: 1, not at all. */
  zoom?: number;
  /** The page's element at a point, Closeup's own layers left out: what a scroll turns. */
  hit: (x: number, y: number) => Element | null;
  /** Each character typed, for its sound. */
  onKey?: () => void;
  /** Each step as it begins, for an editor's timeline. */
  onStep?: (index: number) => void;
  signal?: AbortSignal;
  /** Seconds to wait where it starts before the first move. */
  lead?: number;
};

/** Where `target` is on screen now: on its element if that's still in the page and drawn, else at its page point. */
export function resolve(target: Target, toScreen: (p: Point) => Point, scale: number): Place {
  if (target.on) {
    let element: Element | null = null;
    try {
      element = document.querySelector(target.on.selector);
    } catch {
      // A selector this browser can't read: fall back to the point.
    }
    const box = element?.getBoundingClientRect();
    if (box && (box.width || box.height)) {
      return { x: box.left + target.on.u * box.width, y: box.top + target.on.v * box.height, size: Math.max(4, Math.min(box.width, box.height)) };
    }
  }
  return { ...toScreen(target), size: 24 * scale };
}

const rest = (seconds: number, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    if (signal?.aborted || seconds <= 0) return done();
    const timer = setTimeout(done, seconds * 1000);
    signal?.addEventListener("abort", () => (clearTimeout(timer), done()), { once: true });
  });

/** Calls `frame` with 0→1 (and the seconds gone) over `seconds`, once per animation frame, ending on 1 exactly. */
const animate = (seconds: number, frame: (t: number, elapsed: number) => void, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    if (seconds <= 0) return (frame(1, 0), done());
    const start = performance.now();
    const tick = (now: number) => {
      if (signal?.aborted) return done();
      const elapsed = Math.max(0, (now - start) / 1000);
      const t = Math.min(1, elapsed / seconds);
      frame(t, elapsed);
      if (t < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });

/** How long before the cursor arrives the camera starts closing in: about as long as closing in takes. */
export const ZOOM_LEAD = 0.7;
/** How long drawing back takes once the last step is done: counted into a script's length. */
export const ZOOM_BACK = 0.8;
/** How far inside the view a point must be for the camera to stay close and glide to it: a share of the view. */
const CLEAR = 0.12;

/** Whether a step has the camera close in: a click or typing, when it closes in at all. */
export const closesIn = (step: Step, zoom: number) => zoom > 1 && (step.action === "click" || step.action === "type");

export async function play(script: Script, options: PlayOptions) {
  const { cursor, pointer, camera, signal } = options;
  const zoom = options.zoom ?? 1;
  // Where the cursor is, as a point of the page, and while it scrolls where it's held on screen.
  let here = camera.toPage(resolve(script.start, camera.toScreen, camera.view.scale));
  let held: Point | null = null;
  const draw = (quiet = false) => {
    const q = held ?? camera.toScreen(here);
    cursor.zoom(camera.level);
    cursor.place(q.x, q.y);
    pointer.moveTo(q.x, q.y, { quiet });
  };
  // The page moving under a hand that isn't: the cursor goes with what it's over.
  const off = camera.onMove(() => draw(true));
  try {
    draw();
    await rest(options.lead ?? LEAD, signal);
    let out = script.out;
    for (const [k, step] of script.steps.entries()) {
      if (signal?.aborted) return;
      options.onStep?.(k);
      const place = resolve(step.to, camera.toScreen, camera.view.scale);
      const to = camera.toPage(place);
      const path = measure(curve(here, to, out, step.in, 1));
      // Paced on screen as it is now: closed in, the reach and what it reaches for are both bigger, so the pace is the same.
      const seconds = moveDuration(step, path.total * camera.view.scale, place.size);
      // Close: glide over to what's next if it's in view, else draw back. Closing in on it starts so as to land as the cursor does.
      let closeAt: number | null = null;
      if (camera.zoomed) {
        const inView = camera.shows(to, CLEAR) && step.action !== "scroll";
        if (inView && closesIn(step, zoom)) camera.focusOn(to);
        else if (!inView) camera.zoomOut();
      }
      if (closesIn(step, zoom) && !camera.zoomed) closeAt = Math.max(0, seconds - ZOOM_LEAD);
      await animate(
        seconds,
        (t, elapsed) => {
          if (closeAt !== null && elapsed >= closeAt) {
            closeAt = null;
            camera.zoomTo(to, zoom);
          }
          here = pointAt(path, minimumJerk(t) * path.total);
          draw();
        },
        signal,
      );
      if (closeAt !== null) camera.zoomTo(to, zoom);
      here = to;
      if (signal?.aborted) return;
      if (step.action !== "move") await rest(step.hover ?? 0, signal);
      if (step.action === "click" || step.action === "type") await press(options);
      if (step.action === "type") await type(step.text ?? "", options);
      if (step.action === "scroll") {
        const q = camera.toScreen(here);
        held = q;
        await scroll(step.scroll ?? 0, q, options);
        held = null;
        // Over whatever came under it.
        here = camera.toPage(q);
      }
      await rest(step.wait, signal);
      out = step.out;
    }
    if (camera.zoomed && !signal?.aborted) {
      camera.zoomOut();
      await Promise.race([camera.rest(), rest(ZOOM_BACK * 2, signal)]);
    }
  } finally {
    off();
  }
}

/**
 * A wheel turned `distance` page pixels under the cursor, at `q` on screen. The page is told
 * as a wheel tells it and may take the scroll itself; otherwise what scrolls there scrolls (the
 * part of the page found when the wheel starts turning, as browsers keep to one for a gesture),
 * or the camera pans down the page.
 */
async function scroll(distance: number, q: Point, { camera, hit, signal }: PlayOptions) {
  if (!distance) return;
  const target = hit(q.x, q.y) ?? document.documentElement;
  const scroller = scrollerFor(target, distance);
  const from = scroller?.scrollTop ?? 0;
  let turned = 0;
  let scrolled = 0;
  await animate(
    scrollDuration(distance),
    (t) => {
      const delta = minimumJerk(t) * distance - turned;
      if (!delta) return;
      turned += delta;
      const wheel = new WheelEvent("wheel", { deltaY: delta, deltaMode: 0, clientX: q.x, clientY: q.y, bubbles: true, cancelable: true, composed: true, view: window });
      // Taken by the page, its own way.
      if (!target.dispatchEvent(wheel)) return;
      scrolled += delta;
      // Set rather than added to, so fractions of a pixel aren't lost on the way.
      if (scroller) scroller.scrollTop = from + scrolled;
      else camera.panBy(delta, { now: true });
    },
    signal,
  );
}

/**
 * A move's curve on screen: the handles given (stored in page pixels, so enlarged by `scale`),
 * else a gentle arc. The editor draws the same curve the player travels.
 */
export function curve(from: Point, to: Point, out: Point | undefined, into: Point | undefined, scale: number): PathNode[] {
  const arc = autoHandles(from, to);
  const enlarge = (p: Point) => ({ x: p.x * scale, y: p.y * scale });
  return [
    { at: from, out: out ? enlarge(out) : arc.out },
    { at: to, in: into ? enlarge(into) : arc.in },
  ];
}

/**
 * About how long a script plays, as it would from here: the lead, every move at its pace, the
 * actions (scrolls included), the rests, drawing back if the camera closed in, and the tail.
 * `scrolled(k)` is how far below where it arrived the cursor leaves point `k`, on screen (a
 * scroll of the page moves the page under it).
 */
export function estimate(script: Script, place: (target: Target) => Place, scale: number, zoom = 1, scrolled: (k: number) => number = () => 0) {
  let total = LEAD + TAIL;
  let at = place(script.start);
  let out = script.out;
  for (const [j, step] of script.steps.entries()) {
    const to = place(step.to);
    total += moveDuration(step, measure(curve(at, to, out, step.in, scale)).total, to.size) + actionDuration(step) + step.wait;
    at = { ...to, y: to.y + scrolled(j + 1) };
    out = step.out;
  }
  if (script.steps.some((step) => closesIn(step, zoom))) total += ZOOM_BACK;
  return total;
}

async function press({ cursor, pointer, signal }: PlayOptions) {
  pointer.down();
  cursor.press(true);
  await rest(PRESS, signal);
  pointer.up();
  cursor.press(false);
}

/** Types into whatever has focus, a character at a time, as the browser would insert them. */
async function type(text: string, { signal, onKey }: PlayOptions) {
  const delays = typingDelays(text);
  for (const [k, character] of [...text].entries()) {
    await rest(delays[k], signal);
    if (signal?.aborted) return;
    const field = document.activeElement;
    const key = character === "\n" ? "Enter" : character;
    field?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, composed: true }));
    if (character === "\n") {
      if (field instanceof HTMLInputElement) field.form?.requestSubmit();
      else document.execCommand("insertLineBreak");
    } else if (!document.execCommand("insertText", false, character) && (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
      // Where insertText isn't honoured: set the value as a framework's input would see it.
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
      setter?.call(field, field.value + character);
      field.dispatchEvent(new InputEvent("input", { bubbles: true, data: character, inputType: "insertText" }));
    }
    field?.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true, composed: true }));
    onKey?.();
  }
}
