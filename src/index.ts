/**
 * Closeup: film any part of a web page in close-up, sharp at any size. Press the shortcut,
 * pick an element or draw a region, choose photo or video, and film it: the page is enlarged
 * round your pick so the browser draws it large, a drawn cursor stands in for yours (or plays a
 * script you draw), and the take can sit on a background with its clicks and the tab's sound.
 *
 *   import { install } from "@cesarvenzac/closeup";
 *   install(); // ⌥⇧C opens and closes it
 *
 * `addAction` puts a button of your own on the finished take, to keep it somewhere.
 */

import { matches, parseShortcut, shortcutLabel, typing } from "./shortcut.ts";
import { Panel } from "./ui/panel.ts";

export { addAction, type Take, type TakeAction } from "./actions.ts";
export { supportsCapture } from "./capture.ts";
export { parseScript, type Script, type Step, type Target } from "./script.ts";
export type { Settings } from "./settings.ts";
export { loadScript, saveScript } from "./store.ts";

export const DEFAULT_SHORTCUT = "Alt+Shift+C";

let panel: Panel | null = null;
let label = shortcutLabel(parseShortcut(DEFAULT_SHORTCUT));

const instance = () => (panel ??= new Panel(label));

export const open = () => instance().open();
export const close = () => panel?.close();
export const toggle = () => instance().toggle();

/** Opens and closes Closeup with `shortcut` (⌥⇧C unless told otherwise). Returns what removes it. */
export function install({ shortcut = DEFAULT_SHORTCUT }: { shortcut?: string } = {}) {
  const parsed = parseShortcut(shortcut);
  label = shortcutLabel(parsed);
  const onKey = (event: KeyboardEvent) => {
    if (event.repeat || !matches(event, parsed) || typing(event.composedPath()[0] ?? event.target)) return;
    event.preventDefault();
    toggle();
  };
  addEventListener("keydown", onKey, true);
  return () => removeEventListener("keydown", onKey, true);
}
