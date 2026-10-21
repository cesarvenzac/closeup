/**
 * The camera over a staged page: it closes in on a point and pans down the page, on springs,
 * by moving <body>'s transform a frame at a time. What it shows is `cameraView` (`frame.ts`):
 * never past what the stage showed across, never past the page's top or bottom. Points of the
 * page (as laid out) and points on screen convert through the view as it is now, so a drawn
 * cursor can stay on the page while the camera moves. The clock and what it draws on are
 * passed in, so it runs on a test's clock too.
 */

import { cameraView, panRange, type Rect, type Stage, toPage, toScreen, type View } from "./frame.ts";
import type { Point } from "./path.ts";

export type Spring = { stiffness: number; damping: number };

/** Closing in and drawing back: about two thirds of a second, critically damped (no overshoot). */
export const ZOOM_SPRING: Spring = { stiffness: 80, damping: 2 * Math.sqrt(80) };
/** Panning: quick enough to feel like the wheel moved it, smooth enough to round off a wheel's steps. */
export const PAN_SPRING: Spring = { stiffness: 320, damping: 2 * Math.sqrt(320) };

/** Close enough to rest, in zoom levels and page pixels, and in their speeds. */
const REST = { zoom: 1e-4, page: 0.01 };
/** The longest step a spring takes at once, in seconds: stiff springs need small ones. */
const SUBSTEP = 1 / 240;

type Axis = { value: number; velocity: number; target: number };

/** One spring moved on by `dt` seconds toward its target (semi-implicit Euler, in substeps). */
export function stepAxis(axis: Axis, spring: Spring, dt: number): Axis {
  let { value, velocity } = axis;
  for (let left = dt; left > 1e-9; left -= SUBSTEP) {
    const h = Math.min(SUBSTEP, left);
    velocity += (-spring.stiffness * (value - axis.target) - spring.damping * velocity) * h;
    value += velocity * h;
  }
  return { value, velocity, target: axis.target };
}

const settledAxis = (axis: Axis, epsilon: number) => Math.abs(axis.value - axis.target) < epsilon && Math.abs(axis.velocity) < epsilon * 10;

export type CameraOptions = {
  stage: Stage;
  /** The page's scroll while staged: locked, so it doesn't change. */
  scroll: Point;
  /** How tall the page is, as laid out: how far down it may pan. */
  pageHeight: number;
  /** Draws a view: <body>'s transform, unless told otherwise. */
  apply?: (view: View) => void;
  /** The clock: animation frames, unless told otherwise. */
  frame?: (callback: (now: number) => void) => number;
  cancel?: (id: number) => void;
  /** Every change made at once rather than moved to (reduced motion). */
  still?: boolean;
};

const transformOf = (view: View) => `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`;

export class Camera {
  readonly stage: Stage;
  readonly scroll: Point;
  readonly range: [number, number];
  private zoom: Axis = { value: 1, velocity: 0, target: 1 };
  private fx: Axis = { value: 0, velocity: 0, target: 0 };
  private fy: Axis = { value: 0, velocity: 0, target: 0 };
  private pan: Axis = { value: 0, velocity: 0, target: 0 };
  private readonly listeners = new Set<(view: View) => void>();
  private waiting: (() => void)[] = [];
  private id = 0;
  private last = 0;
  private stopped = false;
  private readonly apply: (view: View) => void;
  private readonly frame: (callback: (now: number) => void) => number;
  private readonly cancel: (id: number) => void;
  private readonly still: boolean;

  constructor(options: CameraOptions) {
    this.stage = options.stage;
    this.scroll = options.scroll;
    this.range = panRange(options.stage, options.scroll, options.pageHeight);
    this.apply = options.apply ?? ((view) => (document.body.style.transform = transformOf(view)));
    this.frame = options.frame ?? ((callback) => requestAnimationFrame(callback));
    this.cancel = options.cancel ?? ((id) => cancelAnimationFrame(id));
    this.still = options.still ?? false;
    const centre = toPage(this.stage, this.scroll, { x: this.stage.screen.x + this.stage.screen.width / 2, y: this.stage.screen.y + this.stage.screen.height / 2 });
    this.fx = { value: centre.x, velocity: 0, target: centre.x };
    this.fy = { value: centre.y, velocity: 0, target: centre.y };
  }

  /** The view as it is now. */
  get view(): View {
    return this.viewOf(this.zoom.value, this.fx.value, this.fy.value, this.pan.value);
  }

  /** The view the camera is heading for. */
  get heading(): View {
    return this.viewOf(this.zoom.target, this.fx.target, this.fy.target, this.pan.target);
  }

  /** How much closer than the stage it is now (1: not at all). */
  get level() {
    return Math.max(1, this.zoom.value);
  }

  /** Whether it's closing in or closed in: drawing back counts as not. */
  get zoomed() {
    return this.zoom.target > 1;
  }

  get settled() {
    return settledAxis(this.zoom, REST.zoom) && settledAxis(this.fx, REST.page) && settledAxis(this.fy, REST.page) && settledAxis(this.pan, REST.page);
  }

  toScreen = (p: Point) => toScreen(this.view, this.scroll, p);
  toPage = (q: Point) => toPage(this.view, this.scroll, q);

  /** The point of the page at `q` on screen were the camera not closed in, panned where it's heading. */
  under(q: Point) {
    return toPage(this.viewOf(1, 0, 0, this.pan.target), this.scroll, q);
  }

  /** Whether the view it's heading for shows `p`, a point of the page, `inset` (a share of the view) inside its edges. */
  shows(p: Point, inset = 0) {
    const view = this.heading;
    const corner = toPage(view, this.scroll, this.stage.screen);
    const width = this.stage.screen.width / view.scale;
    const height = this.stage.screen.height / view.scale;
    return p.x >= corner.x + width * inset && p.x <= corner.x + width * (1 - inset) && p.y >= corner.y + height * inset && p.y <= corner.y + height * (1 - inset);
  }

  /** The part of the page the frame shows now. */
  shown(): Rect {
    const corner = this.toPage(this.stage.screen);
    return { x: corner.x, y: corner.y, width: this.stage.screen.width / this.view.scale, height: this.stage.screen.height / this.view.scale };
  }

  /**
   * Closes in `level` times toward `focus`, a point of the page, which stays where it is on
   * screen as far as the frame allows. From the stage it starts there; already closed in, it
   * glides over to it.
   */
  zoomTo(focus: Point, level: number) {
    const fresh = this.zoom.value <= 1 + 1e-3;
    this.zoom.target = Math.max(1, level);
    this.fx.target = focus.x;
    this.fy.target = focus.y;
    if (fresh) {
      this.fx = { value: focus.x, velocity: 0, target: focus.x };
      this.fy = { value: focus.y, velocity: 0, target: focus.y };
    }
    this.wake();
  }

  /** Glides to `focus` at the level it's at (or heading for). */
  focusOn(focus: Point) {
    this.fx.target = focus.x;
    this.fy.target = focus.y;
    this.wake();
  }

  /** Draws back to the stage, about the point it closed in on. */
  zoomOut() {
    this.zoom.target = 1;
    this.wake();
  }

  /** How far down the page it's panned (page pixels; negative is up), now and where it's heading. */
  get panned() {
    return this.pan.value;
  }

  /** Pans `dy` page pixels further down (up when negative), as far as the page goes; `now` moves there at once. */
  panBy(dy: number, { now = false } = {}) {
    const target = Math.max(this.range[0], Math.min(this.range[1], this.pan.target + dy));
    this.pan.target = target;
    if (now && !this.stopped) {
      // Drawn in this frame: whatever moves the page a frame at a time keeps it in step.
      this.pan = { value: target, velocity: 0, target };
      this.draw();
    }
    if (this.settled) this.release();
    else this.wake();
    return target;
  }

  /** Pans to `y` page pixels down from where the stage was (as far as the page goes). */
  panTo(y: number, options?: { now?: boolean }) {
    return this.panBy(y - this.pan.target, options);
  }

  /** Where it's panning to. */
  get panTarget() {
    return this.pan.target;
  }

  /** Whether the page goes on that way: down for a positive `dy`, up for a negative one. */
  canPan(dy: number) {
    return dy > 0 ? this.pan.target < this.range[1] - 0.5 : dy < 0 ? this.pan.target > this.range[0] + 0.5 : false;
  }

  /** Called with the view after every frame it draws. Returns what stops it. */
  onMove(listener: (view: View) => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Resolves once it's at rest (at once if it is), or once it's stopped. */
  rest(): Promise<void> {
    if (this.settled || this.stopped) return Promise.resolve();
    return new Promise((done) => this.waiting.push(done));
  }

  /** Stops moving, leaving the page where it is (the stage puts it back). */
  stop() {
    this.stopped = true;
    this.cancel(this.id);
    this.id = 0;
    this.release();
  }

  private viewOf(zoom: number, fx: number, fy: number, pan: number): View {
    return cameraView(this.stage, this.scroll, zoom, { x: fx, y: fy }, pan, this.range);
  }

  private wake() {
    if (this.stopped) return;
    if (this.still) {
      for (const axis of [this.zoom, this.fx, this.fy, this.pan]) {
        axis.value = axis.target;
        axis.velocity = 0;
      }
      this.draw();
      this.release();
      return;
    }
    if (this.id) return;
    this.last = 0;
    this.id = this.frame(this.tick);
  }

  private tick = (now: number) => {
    this.id = 0;
    if (this.stopped) return;
    // A frame's worth at the start, and no more than a few frames' after a stall.
    const dt = this.last ? Math.min(1 / 30, Math.max(0, (now - this.last) / 1000)) : 1 / 60;
    this.last = now;
    this.zoom = stepAxis(this.zoom, ZOOM_SPRING, dt);
    this.fx = stepAxis(this.fx, ZOOM_SPRING, dt);
    this.fy = stepAxis(this.fy, ZOOM_SPRING, dt);
    this.pan = stepAxis(this.pan, PAN_SPRING, dt);
    const settled = this.settled;
    if (settled) for (const axis of [this.zoom, this.fx, this.fy, this.pan]) Object.assign(axis, { value: axis.target, velocity: 0 });
    this.draw();
    if (settled) this.release();
    else this.id = this.frame(this.tick);
  };

  private draw() {
    const view = this.view;
    this.apply(view);
    for (const listener of this.listeners) listener(view);
  }

  private release() {
    const waiting = this.waiting;
    this.waiting = [];
    for (const done of waiting) done();
  }
}
