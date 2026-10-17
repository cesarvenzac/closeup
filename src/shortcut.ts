/** Keyboard shortcuts as people write them ("Alt+Shift+C"), matched by key position so ⌥ letters still match on a Mac. */

export type Shortcut = { alt: boolean; shift: boolean; meta: boolean; ctrl: boolean; code: string };

const MODIFIERS: Record<string, keyof Omit<Shortcut, "code">> = {
  alt: "alt",
  option: "alt",
  "⌥": "alt",
  shift: "shift",
  "⇧": "shift",
  meta: "meta",
  cmd: "meta",
  command: "meta",
  "⌘": "meta",
  ctrl: "ctrl",
  control: "ctrl",
  "⌃": "ctrl",
};

/** "Alt+Shift+C" → the modifiers and the key's code ("KeyC"); a digit is "Digit1". Every shortcut needs a modifier. */
export function parseShortcut(text: string): Shortcut {
  const parts = text.split("+").map((part) => part.trim()).filter(Boolean);
  const shortcut: Shortcut = { alt: false, shift: false, meta: false, ctrl: false, code: "" };
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier) shortcut[modifier] = true;
    else if (/^[a-z]$/i.test(part)) shortcut.code = `Key${part.toUpperCase()}`;
    else if (/^[0-9]$/.test(part)) shortcut.code = `Digit${part}`;
    else shortcut.code = part;
  }
  if (!shortcut.code) throw new Error(`No key in shortcut "${text}"`);
  if (!shortcut.alt && !shortcut.meta && !shortcut.ctrl) throw new Error(`Shortcut "${text}" needs ⌥, ⌘ or Ctrl: a bare key would fire while typing`);
  return shortcut;
}

type KeyLike = { code: string; altKey: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

export const matches = (event: KeyLike, shortcut: Shortcut) =>
  event.code === shortcut.code &&
  event.altKey === shortcut.alt &&
  event.shiftKey === shortcut.shift &&
  event.metaKey === shortcut.meta &&
  event.ctrlKey === shortcut.ctrl;

/** For showing: "⌥⇧C". */
export function shortcutLabel(shortcut: Shortcut) {
  const key = shortcut.code.replace(/^Key|^Digit/, "");
  return `${shortcut.ctrl ? "⌃" : ""}${shortcut.alt ? "⌥" : ""}${shortcut.shift ? "⇧" : ""}${shortcut.meta ? "⌘" : ""}${key}`;
}

/** Typing in a field isn't reaching for a shortcut: there ⌥⇧C types a letter. */
export const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
