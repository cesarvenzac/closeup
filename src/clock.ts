/**
 * The page's clock, taken over for a take made a frame at a time (Render): `performance.now`,
 * `Date.now`, timers and animation frames read Closeup's time, which moves only when `step` is
 * called, and every CSS and Web Animation is held and set to it. What the page draws after a step
 * is exactly that moment, however long it took to draw. `release` hands the page its own clock
 * back, timers and frames still waiting moved onto it. Code that kept its own copy of a timing
 * function before the take started doesn't follow; everything that calls it as it goes does.
 * Videos and sounds playing are held too (`mediaClock`): paused for real and moved on a step at a
 * time by seeking, the page still told they play. Left on real time, a video raced through a take.
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
  document?: { getAnimations?(): Animation[]; querySelectorAll?(selector: string): ArrayLike<Element> };
  /** Videos and sounds, held on the clock through their prototype. */
  HTMLMediaElement?: { prototype: HTMLMediaElement };
  addEventListener?(type: string, listener: (event: Event) => void, capture: boolean): void;
  removeEventListener?(type: string, listener: (event: Event) => void, capture: boolean): void;
};

export type Clock = {
  /** Milliseconds moved on since the clock was taken. */
  readonly elapsed: number;
  /**
   * Moves time on by `ms`: the timers due within it, each at its moment, every video and sound
   * playing, then one animation frame, then every animation set to it. Resolves once that frame ran:
   * at once, unless a video had to seek to its new moment first.
   */
  step(ms: number): Promise<void>;
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
  const media = mediaClock(host, real.timeout);
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
      if (released) return Promise.resolve();
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
      const draw = () => {
        const due = frames;
        frames = [];
        for (const { callback } of due) run(() => callback(origin + now));
        hold();
      };
      // The frame that draws the videos waits for them to be at their new moment.
      const seeks = media?.move(ms) ?? [];
      if (!seeks.length) {
        draw();
        return Promise.resolve();
      }
      return Promise.all(seeks).then(draw);
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
      media?.release();
    },
  };
}

const MEDIA_EVENTS = ["play", "playing", "pause"];
/** How long a seek may take before a step goes on without it, in real milliseconds. */
const SEEK_AT_MOST = 2000;

/**
 * Videos and sounds on the clock: each one playing is paused for real and moved on by a seek each
 * step (`move`), while the page is told it plays (`paused` reads false, and none of the play and
 * pause events this causes reach it: a capture listener on the window runs before the page's, and
 * one on the element itself for one outside the document). One the page plays during the take is
 * held from the start, one it pauses let go, and one that reaches its end loops or ends as it would.
 * A live stream is left alone.
 * `release` plays each one still held for real, from where the take left it.
 */
export function mediaClock(host: Host, realTimeout: (run: () => void, ms: number) => unknown) {
  const proto = host.HTMLMediaElement?.prototype;
  const paused = proto && Object.getOwnPropertyDescriptor(proto, "paused");
  if (!proto || !paused?.get) return null;
  const original = { play: proto.play, pause: proto.pause };
  const really = (element: HTMLMediaElement) => paused.get!.call(element) as boolean;
  const playing = new Set<HTMLMediaElement>();
  // Events this causes, by element, still to come: the page never hears them.
  const ours = new WeakMap<EventTarget, string[]>();
  const spare = (event: Event) => {
    const left = ours.get(event.target!);
    const k = left?.indexOf(event.type) ?? -1;
    if (k < 0) return;
    left!.splice(k, 1);
    event.stopImmediatePropagation();
  };
  const unseen = (element: HTMLMediaElement, ...types: string[]) => {
    ours.set(element, [...(ours.get(element) ?? []), ...types]);
    for (const type of types) element.addEventListener(type, spare, true);
  };
  // What the page would hear from a video playing for real, told as a browser tells it: a moment later.
  const told = (element: HTMLMediaElement, ...types: string[]) => queueMicrotask(() => types.forEach((type) => element.dispatchEvent(new Event(type))));
  // A live stream (Closeup's own capture among them) has no moments to move through: it plays on.
  const live = (element: HTMLMediaElement) => element.srcObject != null;
  const take = (element: HTMLMediaElement) => {
    if (playing.has(element) || live(element)) return;
    playing.add(element);
    if (!really(element)) {
      unseen(element, "pause");
      original.pause.call(element);
    }
  };
  const everyOne = () => Array.from(host.document?.querySelectorAll?.("video, audio") ?? []) as HTMLMediaElement[];

  for (const type of MEDIA_EVENTS) host.addEventListener?.(type, spare, true);
  Object.defineProperty(proto, "paused", {
    configurable: true,
    get(this: HTMLMediaElement) {
      return playing.has(this) ? false : really(this);
    },
  });
  proto.play = function (this: HTMLMediaElement) {
    if (live(this)) return original.play.call(this);
    if (!playing.has(this)) {
      if (this.ended) this.currentTime = 0;
      playing.add(this);
      told(this, "play", "playing");
    }
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    if (playing.delete(this)) told(this, "pause");
    return original.pause.call(this);
  };
  for (const element of everyOne()) if (!really(element)) take(element);

  return {
    /** Every one playing moved on by `ms` of its own time: the seeks, each resolved once it's there (or given up on). */
    move(ms: number): Promise<void>[] {
      // One that started by itself (autoplay) is held from here.
      for (const element of everyOne()) if (!really(element)) take(element);
      const seeks: Promise<void>[] = [];
      for (const element of playing) {
        // Until it knows its length it stays where it is.
        if (element.readyState < 1 || !Number.isFinite(element.duration)) continue;
        let at = element.currentTime + (ms / 1000) * element.playbackRate;
        if (at >= element.duration) {
          if (element.loop) at %= element.duration;
          else {
            at = element.duration;
            playing.delete(element);
            told(element, "pause", "ended");
          }
        }
        seeks.push(
          new Promise((resolve) => {
            element.addEventListener("seeked", () => resolve(), { once: true });
            realTimeout(resolve, SEEK_AT_MOST);
          }),
        );
        element.currentTime = at;
      }
      return seeks;
    },
    release() {
      // Kept a moment, until the play events this causes have come: it spares only those.
      realTimeout(() => {
        for (const type of MEDIA_EVENTS) host.removeEventListener?.(type, spare, true);
      }, SEEK_AT_MOST);
      Object.defineProperty(proto, "paused", paused);
      proto.play = original.play;
      proto.pause = original.pause;
      for (const element of playing) {
        unseen(element, "play", "playing");
        void original.play.call(element).catch(() => {});
      }
      playing.clear();
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
