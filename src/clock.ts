/**
 * The page's clock, taken over for a take made a frame at a time (Render): `performance.now`,
 * `Date.now`, timers and animation frames read Closeup's time, which moves only when `step` is
 * called, and every CSS and Web Animation is held and set to it. What the page draws after a step
 * is exactly that moment, however long it took to draw. `release` hands the page its own clock
 * back, timers and frames still waiting moved onto it. Code that kept its own copy of a timing
 * function before the take started doesn't follow; everything that calls it as it goes does.
 */

type Callback = (...args: unknown[]) => void;

/** What the clock takes over: a window, or a stand-in for one in a test. */
export type Host = {
  performance: { now(): number };
  Date: { now(): number };
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(id: number): void;
  setTimeout(handler: Callback, ms?: number, ...args: unknown[]): number;
  setInterval(handler: Callback, ms?: number, ...args: unknown[]): number;
  clearTimeout(id?: number): void;
  clearInterval(id?: number): void;
  document?: { getAnimations?(): Animation[] };
};

export type Clock = {
  /** Milliseconds moved on since the clock was taken. */
  readonly elapsed: number;
  /** Moves time on by `ms`: the timers due within it, each at its moment, then one animation frame, then every animation set to it. */
  step(ms: number): void;
  /** Holds and sets every animation again: those the page started since the last step too. */
  hold(): void;
  /** Gives the page its own clock back. */
  release(): void;
};

/** Ids of Closeup's own, far above the browser's, so neither is ever taken for the other. */
const FIRST_ID = 1_000_000_000;

type Timer = { at: number; every: number; run: () => void };

export function takeTime(host: Host = globalThis as unknown as Host): Clock {
  const real = {
    now: host.performance.now.bind(host.performance),
    dateNow: host.Date.now.bind(host.Date),
    frame: host.requestAnimationFrame.bind(host),
    cancelFrame: host.cancelAnimationFrame.bind(host),
    timeout: host.setTimeout.bind(host),
    interval: host.setInterval.bind(host),
    clearTimeout: host.clearTimeout.bind(host),
    clearInterval: host.clearInterval.bind(host),
  };
  const origin = real.now();
  const dateOrigin = real.dateNow();
  let now = 0;
  let nextId = FIRST_ID;
  let frames: { id: number; callback: (time: number) => void }[] = [];
  const timers = new Map<number, Timer>();
  const held = new Map<Animation, { from: number; at: number }>();
  let released = false;

  const run = (callback: () => void) => {
    try {
      callback();
    } catch (error) {
      // As a browser does: one callback's error is reported, the others still run.
      void Promise.reject(error);
    }
  };
  const later = (repeat: boolean) => (handler: Callback, ms = 0, ...args: unknown[]) => {
    const id = nextId++;
    const wait = Math.max(0, Number(ms) || 0);
    timers.set(id, { at: now + wait, every: repeat ? Math.max(1, wait) : 0, run: () => handler(...args) });
    return id;
  };

  host.performance.now = () => origin + now;
  host.Date.now = () => dateOrigin + Math.round(now);
  host.requestAnimationFrame = (callback) => {
    const id = nextId++;
    frames.push({ id, callback });
    return id;
  };
  host.cancelAnimationFrame = (id) => {
    frames = frames.filter((frame) => frame.id !== id);
  };
  host.setTimeout = later(false);
  host.setInterval = later(true);
  host.clearTimeout = host.clearInterval = (id?: number) => {
    if (id !== undefined && id >= FIRST_ID) timers.delete(id);
    else real.clearTimeout(id);
  };

  const hold = () => {
    for (const animation of host.document?.getAnimations?.() ?? []) {
      let mark = held.get(animation);
      if (!mark) {
        if (animation.playState !== "running") continue;
        mark = { from: Number(animation.currentTime) || 0, at: now };
        held.set(animation, mark);
        animation.pause();
      }
      if (animation.playState === "finished") continue;
      const at = mark.from + (now - mark.at);
      // Past its end it's finished, not held there, so what waits for it to end then does.
      const end = Number(animation.effect?.getComputedTiming().endTime);
      if (Number.isFinite(end) && at >= end) {
        animation.finish();
        held.delete(animation);
      } else animation.currentTime = at;
    }
  };
  hold();

  return {
    get elapsed() {
      return now;
    },
    step(ms) {
      if (released) return;
      const until = now + ms;
      for (;;) {
        let next: [number, Timer] | null = null;
        for (const entry of timers) if (entry[1].at <= until && (!next || entry[1].at < next[1].at)) next = entry;
        if (!next) break;
        const [id, timer] = next;
        now = Math.max(now, timer.at);
        if (timer.every) timer.at += timer.every;
        else timers.delete(id);
        run(timer.run);
      }
      now = until;
      const due = frames;
      frames = [];
      for (const { callback } of due) run(() => callback(origin + now));
      hold();
    },
    hold,
    release() {
      if (released) return;
      released = true;
      // The page's own time again, never behind what it was told: a take is made slower than it plays.
      const shift = Math.max(0, origin + now - real.now());
      host.performance.now = shift ? () => real.now() + shift : real.now;
      host.Date.now = shift ? () => real.dateNow() + shift : real.dateNow;
      host.requestAnimationFrame = real.frame;
      host.cancelAnimationFrame = real.cancelFrame;
      host.setTimeout = real.timeout;
      host.setInterval = real.interval;
      // What's still waiting goes on the page's clock, kept by its ids so it can still be called off.
      const moved = new Map<number, number>();
      for (const [id, timer] of timers) {
        const wait = Math.max(0, timer.at - now);
        moved.set(id, timer.every ? real.interval(timer.run, timer.every) : real.timeout(timer.run, wait));
      }
      for (const { id, callback } of frames) moved.set(id, real.frame(callback));
      host.clearTimeout = host.clearInterval = (id?: number) => real.clearTimeout(id !== undefined && moved.has(id) ? moved.get(id) : id);
      host.cancelAnimationFrame = (id) => real.cancelFrame(moved.get(id) ?? id);
      for (const [animation] of held) if (animation.playState === "paused") animation.play();
      held.clear();
    },
  };
}

/** The page's own time, whoever holds its clock: the capture's frames are stamped with it. */
export const realNow = performance.now.bind(performance);
const realTimeout = setTimeout.bind(globalThis);

/** Lets the page's own work in (React drawing what changed, layout): two of its tasks, on its own clock. */
export const settle = () => new Promise<void>((resolve) => realTimeout(() => realTimeout(resolve, 0), 0));

const realFrame = typeof requestAnimationFrame === "function" ? requestAnimationFrame.bind(globalThis) : (callback: () => void) => realTimeout(callback, 16);

/**
 * Resolves once what the page holds now has been drawn to the screen: two of the browser's own
 * frames (the first draws it, the second starts after that one is shown). A picture of the tab
 * taken from then on shows it; one taken just before may still show the screen before.
 */
export const painted = () => new Promise<void>((resolve) => realFrame(() => realFrame(() => resolve())));
