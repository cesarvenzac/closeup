/** Every choice a take makes, their defaults, and keeping them between visits. */

import type { Shape } from "./frame.ts";
import { SHAPES } from "./frame.ts";

export const GRADIENTS = [
  { name: "Dawn", from: "#f9d9e8", to: "#fdebd3", angle: 135 },
  { name: "Mist", from: "#e3ecfb", to: "#cfdcf1", angle: 160 },
  { name: "Sage", from: "#e6efe2", to: "#cfe0d3", angle: 135 },
  { name: "Sand", from: "#f6f0e6", to: "#e6dcc8", angle: 120 },
  { name: "Dusk", from: "#3b2a6b", to: "#c76b7c", angle: 135 },
  { name: "Ink", from: "#1d1f24", to: "#3a3e47", angle: 160 },
] as const;

export type BackgroundKind = "none" | "color" | "gradient" | "image";

export type Settings = {
  mode: "photo" | "video";
  pick: "element" | "region";
  shape: Shape;
  /** Room round what's picked, a share of its size on each side. */
  padding: number;
  background: BackgroundKind;
  color: string;
  gradient: number;
  /** Room between the take's edge and the page, on a background. */
  inset: number;
  radius: number;
  shadow: boolean;
  cursor: boolean;
  cursorSize: number;
  /** A ring spreading from the cursor's tip on each click. */
  ring: boolean;
  /** Who moves the cursor in a video: your mouse, or the page's saved script. */
  moves: "yours" | "script";
  /** How close the camera comes to each click and to typing, in a video: 1, not at all. */
  zoom: number;
  /** Seconds counted down before a video by hand starts recording, to get a hand to the mouse. */
  countdown: number;
  /** Seconds counted down before a photo is taken, to open a menu or hover something first. */
  timer: number;
  clicks: boolean;
  tabAudio: boolean;
  quality: "standard" | "high";
};

/** The levels the camera may close in to, the countdowns a video may have and the timers a photo may. */
export const ZOOMS = [1, 1.5, 2] as const;
export const COUNTDOWNS = [0, 3, 5] as const;
export const TIMERS = [0, 3, 5, 10] as const;

export const DEFAULTS: Settings = {
  mode: "video",
  pick: "element",
  shape: "16:9",
  padding: 0.3,
  background: "none",
  color: "#f2f1ee",
  gradient: 0,
  inset: 0.08,
  radius: 18,
  shadow: true,
  cursor: true,
  cursorSize: 48,
  ring: true,
  moves: "yours",
  zoom: 1,
  countdown: 3,
  timer: 0,
  clicks: true,
  tabAudio: false,
  quality: "high",
};

const KEY = "closeup:settings";

/** The saved settings over the defaults, anything unknown or of the wrong type left out. */
export function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Record<keyof Settings, unknown>>;
    const settings = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
      if (typeof saved[key] === typeof DEFAULTS[key]) (settings as Record<string, unknown>)[key] = saved[key];
    }
    if (!(settings.shape in SHAPES)) settings.shape = DEFAULTS.shape;
    if (!(settings.gradient in GRADIENTS)) settings.gradient = 0;
    if (settings.moves !== "script") settings.moves = "yours";
    if (!(ZOOMS as readonly number[]).includes(settings.zoom)) settings.zoom = DEFAULTS.zoom;
    if (!(COUNTDOWNS as readonly number[]).includes(settings.countdown)) settings.countdown = DEFAULTS.countdown;
    if (!(TIMERS as readonly number[]).includes(settings.timer)) settings.timer = DEFAULTS.timer;
    return settings;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Private windows and blocked storage: the settings last as long as the page.
  }
}
