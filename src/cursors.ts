/**
 * The drawn cursors, macOS-like and our own drawings (not Apple's images), on a 24-unit grid
 * with each one's hotspot: the point that clicks. Each outline is painted under its fill
 * (`paint-order: stroke`), so the white edge sits outside the black as on a Mac, never eating
 * into it.
 */

export type CursorShape = "arrow" | "hand" | "text";

/** The hand's outline: index finger up, three fingers folded beside it, the thumb out to the left. */
const HAND =
  "M7 15.2V3.4a1.5 1.5 0 0 1 3 0v6.2a1.5 1.5 0 0 1 3 .2v.6a1.5 1.5 0 0 1 3 .3v.7a1.5 1.5 0 0 1 3 .2V16c0 3.3-2.1 5.6-5 5.6h-2.6c-1.6 0-2.7-.6-3.6-1.6l-3.3-3.6a1.3 1.3 0 0 1 1.8-1.9z";
/** The I-beam: a stem with a curl at each end. */
const BEAM = "M9 3.5h1.2c1 0 1.8.8 1.8 1.8m3-1.8h-1.2c-1 0-1.8.8-1.8 1.8v13.4c0 1-.8 1.8-1.8 1.8H9m6 0h-1.2c-1 0-1.8-.8-1.8-1.8";

export const CURSORS: Record<CursorShape, { hot: [number, number]; svg: string }> = {
  arrow: {
    hot: [5, 2.5],
    svg: `<path d="M5 2.5v16.6l4.2-3.9 2.7 6.1 2.6-1.1-2.7-6h5.8z" fill="#000" stroke="#fff" stroke-width="2.4" stroke-linejoin="round" paint-order="stroke"/>`,
  },
  hand: {
    hot: [8.5, 2],
    svg: `<path d="${HAND}" fill="#fff" stroke="#000" stroke-width="1.25" stroke-linejoin="round"/><path d="M10 9.6v2.6M13 10.4v2.4M16 11.2v2.2" fill="none" stroke="#000" stroke-width="1.1" stroke-linecap="round"/>`,
  },
  text: {
    hot: [12, 12],
    svg: `<path d="${BEAM}" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/><path d="${BEAM}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
};
