/**
 * Where to film and how much to enlarge it: pure arithmetic, so it's tested apart from the
 * browser. Rectangles are in CSS pixels in the viewport, as getBoundingClientRect gives them.
 */

export type Rect = { x: number; y: number; width: number; height: number };
export type Size = { width: number; height: number };

/** The shapes a take can have; `free` keeps the shape of what was picked. */
export const SHAPES = { "16:9": 16 / 9, "1:1": 1, "4:5": 4 / 5, "9:16": 9 / 16, free: null } as const;
export type Shape = keyof typeof SHAPES;

/** The most the page is enlarged: past this a few pixels fill the screen and the browser's work grows for nothing. */
export const MOST_SCALE = 40;

/** How much of the window a staged frame fills: the margin round it holds the controls, uncaptured. */
export const FILL = 0.84;
/** The least margin above and below the frame, in CSS pixels: the recording's controls sit there, never in the take. */
export const ROOM = 60;

/** The share of `viewport` a frame fills: FILL, less in a window too short to leave ROOM above and below. */
export const fillFor = (viewport: Size) => Math.max(0.2, Math.min(FILL, 1 - (2 * ROOM) / viewport.height));

/**
 * The area to film round `target`: grown by `padding` (a share of its size on each side),
 * then widened or heightened, never cropped, to `aspect` (null keeps the target's own).
 */
export function frameAround(target: Rect, padding: number, aspect: number | null): Rect {
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  let width = Math.max(1, target.width * (1 + 2 * padding));
  let height = Math.max(1, target.height * (1 + 2 * padding));
  if (aspect) {
    if (width / height < aspect) width = height * aspect;
    else height = width / aspect;
  }
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

export type Stage = {
  /** How much the page is enlarged. */
  scale: number;
  /** The translation, in CSS pixels, that brings the frame to the middle of the viewport once scaled about the page's top left. */
  tx: number;
  ty: number;
  /** Where the frame sits on screen once staged: what's captured. */
  screen: Rect;
};

/**
 * The stage for `frame`: the page scaled about its top left (the document's, so scrolling is
 * counted) until the frame fills `fill` of the viewport in its tighter direction, and moved so
 * the frame sits in the middle. What's outside the frame stays drawn but isn't captured.
 */
export function stageFor(frame: Rect, viewport: Size, fill: number, scroll = { x: 0, y: 0 }): Stage {
  const scale = Math.min(MOST_SCALE, (viewport.width * fill) / frame.width, (viewport.height * fill) / frame.height);
  const cx = frame.x + frame.width / 2 + scroll.x;
  const cy = frame.y + frame.height / 2 + scroll.y;
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    scale,
    tx: viewport.width / 2 + scroll.x - cx * scale,
    ty: viewport.height / 2 + scroll.y - cy * scale,
    screen: { x: (viewport.width - width) / 2, y: (viewport.height - height) / 2, width, height },
  };
}

/**
 * Where a point of the page (document CSS pixels, as laid out) is drawn on screen once staged,
 * the page scrolled by `scroll`: scaled about the page's top left and moved by the stage.
 */
export const toScreen = (stage: Pick<Stage, "scale" | "tx" | "ty">, scroll: { x: number; y: number }, p: { x: number; y: number }) => ({
  x: p.x * stage.scale + stage.tx - scroll.x,
  y: p.y * stage.scale + stage.ty - scroll.y,
});

/** The point of the page drawn at screen point `q` on the stage: `toScreen` the other way. */
export const toPage = (stage: Pick<Stage, "scale" | "tx" | "ty">, scroll: { x: number; y: number }, q: { x: number; y: number }) => ({
  x: (q.x + scroll.x - stage.tx) / stage.scale,
  y: (q.y + scroll.y - stage.ty) / stage.scale,
});

/** The take's size in pixels: the frame on screen at the screen's density, rounded to even numbers as video encoders want. */
export function pixelSize(screen: Rect, density: number): Size {
  const even = (value: number) => Math.max(2, 2 * Math.round((value * density) / 2));
  return { width: even(screen.width), height: even(screen.height) };
}

/**
 * Where a frame of `inner`'s shape sits inside a take of `outer` size once a background with
 * `padding` (a share of the take's shorter side) surrounds it: centred, shape kept.
 */
export function insetRect(outer: Size, padding: number): Rect {
  const margin = padding * Math.min(outer.width, outer.height);
  const scale = Math.min((outer.width - 2 * margin) / outer.width, (outer.height - 2 * margin) / outer.height);
  const width = outer.width * scale;
  const height = outer.height * scale;
  return { x: (outer.width - width) / 2, y: (outer.height - height) / 2, width, height };
}
