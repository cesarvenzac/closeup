/**
 * A cursor's path as an editor draws one: nodes, each with handles, joined by cubic curves
 * (Figma's way), measured by length so the cursor can travel it at a chosen pace whatever
 * the curves' shape. Pure, for scripted takes: the editor draws these nodes, the player
 * reads positions from them.
 */

export type Point = { x: number; y: number };
/** A node and its handles, relative to the node (Figma stores them so); none means a sharp corner. */
export type PathNode = { at: Point; in?: Point; out?: Point };

type Segment = { p0: Point; c1: Point; c2: Point; p3: Point };

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

function cubic({ p0, c1, c2, p3 }: Segment, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p3.y,
  };
}

export function segments(nodes: PathNode[]): Segment[] {
  const out: Segment[] = [];
  for (let k = 0; k + 1 < nodes.length; k++) {
    const a = nodes[k];
    const b = nodes[k + 1];
    out.push({ p0: a.at, c1: a.out ? add(a.at, a.out) : a.at, c2: b.in ? add(b.at, b.in) : b.at, p3: b.at });
  }
  return out;
}

/** The path laid out as a table of lengths, finely enough to read positions by distance. */
export type Measured = { points: Point[]; lengths: number[]; total: number; nodeAt: number[] };

export function measure(nodes: PathNode[], perSegment = 64): Measured {
  const points: Point[] = nodes.length ? [nodes[0].at] : [];
  const lengths = nodes.length ? [0] : [];
  const nodeAt = nodes.length ? [0] : [];
  for (const segment of segments(nodes)) {
    for (let k = 1; k <= perSegment; k++) {
      const p = cubic(segment, k / perSegment);
      const last = points[points.length - 1];
      lengths.push(lengths[lengths.length - 1] + Math.hypot(p.x - last.x, p.y - last.y));
      points.push(p);
    }
    nodeAt.push(lengths[lengths.length - 1]);
  }
  return { points, lengths, total: lengths[lengths.length - 1] ?? 0, nodeAt };
}

/** Where the path is `distance` along it (clamped to its ends). */
export function pointAt({ points, lengths, total }: Measured, distance: number): Point {
  if (!points.length) return { x: 0, y: 0 };
  const d = Math.max(0, Math.min(total, distance));
  let lo = 0;
  let hi = lengths.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = lengths[hi] - lengths[lo];
  return lerp(points[lo], points[hi], span > 0 ? (d - lengths[lo]) / span : 0);
}

/**
 * How long a hand takes to cover `distance` to a target `size` across (Fitts's law): a short
 * fixed part, then a little more for each doubling of distance over size. Seconds.
 */
export function reachTime(distance: number, size = 24) {
  return 0.18 + 0.11 * Math.log2(distance / Math.max(4, size) + 1);
}

/** Eases in and out, as a hand does between two points: slow to start, quick, slow to arrive. */
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
