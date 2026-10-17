/**
 * Plays a script: the drawn cursor travels each curve at a hand's pace, then clicks, types or
 * just rests, and the page is told about every move and press as if a mouse made them
 * (`pointer.ts`). Each target is found when its move begins, on its element if that's still
 * there, so a scene survives a layout that shifted since it was drawn.
 */

import type { DrawnCursor } from "./cursor.ts";
import { measure, type PathNode, type Point, pointAt } from "./path.ts";
import type { SyntheticPointer } from "./pointer.ts";
import { actionDuration, autoHandles, LEAD, minimumJerk, moveDuration, PRESS, type Script, type Step, TAIL, type Target, typingDelays } from "./script.ts";

/** A target found on screen, and the size of what it's on (for the pace of reaching it). */
export type Place = Point & { size: number };

export type PlayOptions = {
  cursor: DrawnCursor;
  pointer: SyntheticPointer;
  /** Where a point of the page (as laid out) is drawn on screen now. */
  toScreen: (p: Point) => Point;
  /** How much the page is enlarged: handles are stored in page pixels. */
  scale: number;
  /** Each character typed, for its sound. */
  onKey?: () => void;
  /** Each step as it begins, for an editor's timeline. */
  onStep?: (index: number) => void;
  signal?: AbortSignal;
  /** Seconds to wait where it starts before the first move. */
  lead?: number;
};

/** Where `target` is on screen now: on its element if that's still in the page and drawn, else at its page point. */
export function resolve(target: Target, toScreen: PlayOptions["toScreen"], scale: number): Place {
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

/** Calls `frame` with 0→1 over `seconds`, once per animation frame, ending on 1 exactly. */
const animate = (seconds: number, frame: (t: number) => void, signal?: AbortSignal) =>
  new Promise<void>((done) => {
    if (seconds <= 0) return (frame(1), done());
    const start = performance.now();
    const tick = (now: number) => {
      if (signal?.aborted) return done();
      const t = Math.min(1, (now - start) / (seconds * 1000));
      frame(t);
      if (t < 1) requestAnimationFrame(tick);
      else done();
    };
    requestAnimationFrame(tick);
  });

export async function play(script: Script, options: PlayOptions) {
  const { cursor, pointer, signal, scale } = options;
  const go = (p: Point) => {
    cursor.place(p.x, p.y);
    pointer.moveTo(p.x, p.y);
  };
  let at = resolve(script.start, options.toScreen, scale);
  let out = script.out;
  go(at);
  await rest(options.lead ?? LEAD, signal);
  for (const [k, step] of script.steps.entries()) {
    if (signal?.aborted) return;
    options.onStep?.(k);
    const to = resolve(step.to, options.toScreen, scale);
    await travel(at, to, out, step, go, options);
    if (signal?.aborted) return;
    if (step.action !== "move") await rest(step.hover ?? 0, signal);
    if (step.action === "click" || step.action === "type") await press(options);
    if (step.action === "type") await type(step.text ?? "", options);
    await rest(step.wait, signal);
    at = to;
    out = step.out;
  }
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

/** About how long a script plays, as it would from here: the lead, every move at its pace, the actions, the rests, the tail. */
export function estimate(script: Script, place: (target: Target) => Place, scale: number) {
  let total = LEAD + TAIL;
  let at = place(script.start);
  let out = script.out;
  for (const step of script.steps) {
    const to = place(step.to);
    total += moveDuration(step, measure(curve(at, to, out, step.in, scale)).total, to.size) + actionDuration(step) + step.wait;
    at = to;
    out = step.out;
  }
  return total;
}

/** One move, along its curve, at a hand's pace. */
function travel(from: Place, to: Place, out: Point | undefined, step: Step, go: (p: Point) => void, { scale, signal }: PlayOptions) {
  const path = measure(curve(from, to, out, step.in, scale));
  return animate(moveDuration(step, path.total, to.size), (t) => go(pointAt(path, minimumJerk(t) * path.total)), signal);
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
