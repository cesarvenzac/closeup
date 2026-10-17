import { describe, expect, it } from "vitest";

import { matches, parseShortcut, shortcutLabel } from "./shortcut.ts";

const press = (code: string, mods: Partial<Record<"altKey" | "shiftKey" | "metaKey" | "ctrlKey", boolean>> = {}) => ({
  code,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("read as written, and match by key position whatever the letter typed (⌥⇧C types Ç on a Mac)", () => {
    const shortcut = parseShortcut("Alt+Shift+C");
    expect(matches(press("KeyC", { altKey: true, shiftKey: true }), shortcut)).toBe(true);
    expect(matches(press("KeyC", { altKey: true }), shortcut)).toBe(false);
    expect(matches(press("KeyC", { altKey: true, shiftKey: true, metaKey: true }), shortcut)).toBe(false);
    expect(shortcutLabel(shortcut)).toBe("⌥⇧C");
  });

  it("take symbols and other names for modifiers", () => {
    expect(parseShortcut("⌘⇧+5".replace("⇧", "+⇧"))).toEqual({ alt: false, shift: true, meta: true, ctrl: false, code: "Digit5" });
    expect(parseShortcut("Ctrl+Option+R")).toEqual({ alt: true, shift: false, meta: false, ctrl: true, code: "KeyR" });
  });

  it("need a modifier, or they'd fire while typing", () => {
    expect(() => parseShortcut("Shift+C")).toThrow();
    expect(() => parseShortcut("C")).toThrow();
  });
});
