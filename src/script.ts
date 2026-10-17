/**
 * A scripted take: where the drawn cursor starts, where it goes, by which curves, and what it
 * does on arriving (click, type, or nothing but rest there, which is hovering). Plain data,
 * saved as JSON, so a scene can be played again after the page changes. Pure: the player
 * (`player.ts`) reads it, the editor writes it.
 */

import { type Point, reachTime } from "./path.ts";

/**
 * Where the cursor goes: a point in the page as laid out (document CSS pixels, not enlarged),
 * and the element it was put on, if any, with where in that element's box (0 to 1 across and
 * down), so the point follows the element when the layout moves.
 */
export type Target = { x: number; y: number; on?: { selector: string; u: number; v: number } };

export type Action = "move" | "click" | "type";

export type Step = {
  to: Target;
  /** The curve's handle arriving here, relative to the point, in page pixels; none for a gentle arc. */
  in?: Point;
  /** The handle leaving here toward the next step. */
  out?: Point;
  /** What happens on arriving: "move" only rests there, which is hovering. */
  action: Action;
  /** What "type" types. */
  text?: string;
  /** Seconds resting on arrival before clicking or typing, to show what hovering does. */
  hover?: number;
  /** Seconds the move here takes; none for a hand's pace (Fitts's law). */
  duration?: number;
  /** Seconds to rest after arriving and acting. */
  wait: number;
};

export type Script = {
  version: 1;
  start: Target;
  /** The handle leaving the start. */
  out?: Point;
  steps: Step[];
};

/** How far a move without handles bows, as a share of its length: a wrist turns, so hands don't move in lines. */
export const BEND = 0.12;
/** Seconds the cursor waits where it starts before moving, and lingers after the last step, while filming. */
export const LEAD = 0.6;
export const TAIL = 0.8;
/** A click: the button held this long. */
export const PRESS = 0.075;

/**
 * Minimum jerk: how a hand covers a reach, slow to start, quickest midway, slow to arrive
 * (Flash and Hogan, 1985). Smoother than a cubic ease: its acceleration starts and ends at zero.
 */
export const minimumJerk = (t: number) => {
  const u = Math.max(0, Math.min(1, t));
  return u * u * u * (10 + u * (-15 + 6 * u));
};

/**
 * Handles for a move from `a` to `b` that wasn't given any: a third of the way along each end,
 * pushed to the left of the direction of travel by `bend` of the length, so the move bows
 * gently, as a wrist pivoting does. Relative to their points, as a script stores them.
 */
export function autoHandles(a: Point, b: Point, bend = BEND): { out: Point; in: Point } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  // Left of travel on screen (y grows down): (dy, -dx).
  const nx = dy * bend;
  const ny = -dx * bend;
  return { out: { x: dx / 3 + nx, y: dy / 3 + ny }, in: { x: -dx / 3 + nx, y: -dy / 3 + ny } };
}

/** How long a move takes: as given, or a hand's pace for its length and the size of what it reaches for. */
export const moveDuration = (step: Pick<Step, "duration">, distance: number, size: number) =>
  step.duration ?? (distance < 1 ? 0 : reachTime(distance, size));

/** Seconds between typed characters: a person's uneven rhythm, the same every time for the same text. */
export function typingDelays(text: string): number[] {
  return [...text].map((character, k) => {
    // A small hash of the character and its place, for an even spread in 0–1.
    const h = Math.sin((character.codePointAt(0) ?? 0) * 12.9898 + k * 78.233) * 43758.5453;
    const spread = h - Math.floor(h);
    // Spaces come a little slower, as the next word is reached for.
    return (character === " " ? 0.11 : 0.06) + spread * 0.07;
  });
}

/** How long a step's action lasts once there: a press, or the press and the typing. */
export const actionDuration = (step: Step) =>
  step.action === "click"
    ? (step.hover ?? 0) + PRESS
    : step.action === "type"
      ? (step.hover ?? 0) + PRESS + typingDelays(step.text ?? "").reduce((a, b) => a + b, 0)
      : 0;

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const pointOf = (value: unknown): Point | undefined => {
  const p = value as Point | undefined;
  return p && isNumber(p.x) && isNumber(p.y) ? { x: p.x, y: p.y } : undefined;
};
function targetOf(value: unknown): Target | undefined {
  const t = value as Target | undefined;
  if (!t || !isNumber(t.x) || !isNumber(t.y)) return undefined;
  const on = t.on;
  const anchored = on && typeof on.selector === "string" && on.selector && isNumber(on.u) && isNumber(on.v);
  return { x: t.x, y: t.y, ...(anchored ? { on: { selector: on.selector, u: on.u, v: on.v } } : {}) };
}

/** A script read back from storage or a file, or null if it isn't one; anything unknown is dropped. */
export function parseScript(value: unknown): Script | null {
  const raw = value as Partial<Script> | null;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.steps)) return null;
  const start = targetOf(raw.start);
  if (!start) return null;
  const steps: Step[] = [];
  for (const item of raw.steps as unknown[]) {
    const s = item as Partial<Step>;
    const to = targetOf(s?.to);
    if (!to) return null;
    const action: Action = s.action === "click" || s.action === "type" ? s.action : "move";
    steps.push({
      to,
      ...(pointOf(s.in) ? { in: pointOf(s.in) } : {}),
      ...(pointOf(s.out) ? { out: pointOf(s.out) } : {}),
      action,
      ...(action === "type" ? { text: typeof s.text === "string" ? s.text : "" } : {}),
      ...(action !== "move" && isNumber(s.hover) && s.hover > 0 ? { hover: s.hover } : {}),
      ...(isNumber(s.duration) && s.duration >= 0 ? { duration: s.duration } : {}),
      wait: isNumber(s.wait) && s.wait >= 0 ? s.wait : 0,
    });
  }
  return { version: 1, start, ...(pointOf(raw.out) ? { out: pointOf(raw.out) } : {}), steps };
}
