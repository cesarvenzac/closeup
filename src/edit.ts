/**
 * What's done to a take once filmed: where it starts and ends, and how fast it plays. Pure:
 * the sheet's trim bar sets it, the export reads it.
 */

export type Edit = {
  /** Seconds into the take where the edited one starts. */
  from: number;
  /** And where it ends. */
  to: number;
  /** How many times faster it plays (below 1, slower). */
  speed: number;
};

/** The speeds offered: slowed down, as filmed, and sped up. */
export const SPEEDS = [0.5, 1, 1.5, 2] as const;
/** The least a trim keeps, in seconds. */
export const SHORTEST = 0.3;
/** Close enough to the take's ends to count as untrimmed, in seconds. */
const NEAR = 0.02;

/** The whole take, as filmed. */
export const whole = (duration: number): Edit => ({ from: 0, to: duration, speed: 1 });

/** Whether anything's changed: trimmed at either end, or faster or slower. */
export const isEdited = (edit: Edit, duration: number) => edit.from > NEAR || edit.to < duration - NEAR || edit.speed !== 1;

/** How long the edited take lasts, in seconds. */
export const lengthOf = (edit: Edit) => Math.max(0, edit.to - edit.from) / edit.speed;

/** The start moved to `t`, kept inside the take and at least `SHORTEST` before the end. */
export const startAt = (edit: Edit, t: number): Edit => ({ ...edit, from: Math.max(0, Math.min(edit.to - SHORTEST, t)) });

/** The end moved to `t`, kept inside the take and at least `SHORTEST` after the start. */
export const endAt = (edit: Edit, t: number, duration: number): Edit => ({ ...edit, to: Math.min(duration, Math.max(edit.from + SHORTEST, t)) });

/**
 * The frames a GIF of the edited take shows, `fps` a second of it as it plays: where each is
 * in the take, and how long it's shown in hundredths of a second (as GIF counts), rounded so
 * the delays add up to the edited length.
 */
export function gifFrames(edit: Edit, fps: number): { at: number; delay: number }[] {
  const length = lengthOf(edit);
  const count = Math.max(1, Math.round(length * fps));
  const hundredths = (k: number) => Math.round((Math.min(length, k / fps) * 100));
  return Array.from({ length: count }, (_, k) => ({
    at: edit.from + (k / fps) * edit.speed,
    delay: Math.max(2, (k === count - 1 ? Math.round(length * 100) : hundredths(k + 1)) - hundredths(k)),
  }));
}

/** A moment of a take as the trim bar says it: minutes, seconds and tenths ("0:04.2"). */
export function clock(seconds: number) {
  const tenths = Math.max(0, Math.round(seconds * 10));
  const minutes = Math.floor(tenths / 600);
  const rest = (tenths % 600) / 10;
  return `${minutes}:${rest.toFixed(1).padStart(4, "0")}`;
}

/** The largest GIF width offered, and its frames a second: a GIF is for a glance, and a big one weighs a lot. */
export const GIF_WIDTH = 800;
export const GIF_FPS = 15;

/** A GIF's size for a take's: no wider than `most`, its shape kept. */
export function gifSize(width: number, height: number, most = GIF_WIDTH) {
  const scale = Math.min(1, most / width);
  return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
}
