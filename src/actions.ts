/**
 * Actions of your own on a finished take: buttons on the take's sheet, beside Download, that hand
 * the take to your code (to keep it in a library, send it somewhere, …). Closeup shows the button,
 * its progress while it runs, and what it says when it's done or fails.
 */

import type { Result } from "./take.ts";

/** A finished take: the file, its size, its length, and the script it played if one did. */
export type Take = Result;

export type TakeAction = {
  /** The button's words, e.g. "Save to library". */
  label: string;
  /** An icon beside them: the inside of an SVG on a 24-unit grid, drawn with Closeup's stroke (Lucide's paths fit). */
  icon?: string;
  /** Offered for this take? Every take when left out. */
  when?: (take: Take) => boolean;
  /**
   * Does the work. Call `progress` with 0 to 1 as it goes; what it resolves to is said when it's
   * done ("Saved." when nothing), and a thrown error's message is said instead.
   */
  run: (take: Take, context: { progress: (done: number) => void }) => Promise<string | void>;
};

const registered = new Set<TakeAction>();

/** Offers `action` on every take from now on. Returns what takes it away. */
export function addAction(action: TakeAction) {
  registered.add(action);
  return () => void registered.delete(action);
}

/** The actions offered for a take, in the order they were added. */
export const actionsFor = (take: Take) => [...registered].filter((action) => action.when?.(take) ?? true);
