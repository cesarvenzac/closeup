import { describe, expect, it } from "vitest";

import { type Host, takeTime } from "./clock.ts";

/** A window's clock and timers, on a real time of the test's own. */
function standIn(start = 1000) {
  let real = start;
  const timers: { id: number; at: number; run: () => void }[] = [];
  const frames: { id: number; run: (time: number) => void }[] = [];
  let id = 1;
  const host: Host = {
    performance: { now: () => real },
    Date: { now: () => 1_700_000_000_000 + real },
    requestAnimationFrame: (run) => (frames.push({ id, run }), id++),
    cancelAnimationFrame: (gone) => void frames.splice(frames.findIndex((f) => f.id === gone), 1),
    setTimeout: (run, ms = 0) => (timers.push({ id, at: real + ms, run }), id++),
    setInterval: (run, ms = 0) => (timers.push({ id, at: real + ms, run }), id++),
    clearTimeout: (gone) => void timers.splice(timers.findIndex((t) => t.id === gone), 1),
    clearInterval: (gone) => void timers.splice(timers.findIndex((t) => t.id === gone), 1),
  };
  return {
    host,
    pass: (ms: number) => (real += ms),
    realTimers: timers,
    realFrames: frames,
  };
}

describe("takeTime", () => {
  it("holds time still until it's stepped, whatever real time does", () => {
    const { host, pass } = standIn();
    const clock = takeTime(host);
    const t0 = host.performance.now();
    pass(500);
    expect(host.performance.now()).toBe(t0);
    clock.step(1000 / 60);
    expect(host.performance.now()).toBeCloseTo(t0 + 1000 / 60);
    expect(clock.elapsed).toBeCloseTo(1000 / 60);
    expect(host.Date.now()).toBe(1_700_000_000_000 + 1000 + 17);
  });

  it("runs timers at their own moments within a step, intervals again and again, and one frame a step", () => {
    const { host } = standIn();
    const clock = takeTime(host);
    const seen: string[] = [];
    host.setTimeout(() => seen.push(`late ${host.performance.now() - 1000}`), 30);
    host.setTimeout(() => seen.push(`soon ${host.performance.now() - 1000}`), 10);
    const every = host.setInterval(() => seen.push(`every ${host.performance.now() - 1000}`), 20);
    host.requestAnimationFrame((time) => seen.push(`frame ${time - 1000}`));
    clock.step(40);
    expect(seen).toEqual(["soon 10", "every 20", "late 30", "every 40", "frame 40"]);
    host.clearInterval(every);
    seen.length = 0;
    clock.step(40);
    expect(seen).toEqual([]);
  });

  it("lets a frame asked for in a frame wait for the next step", () => {
    const { host } = standIn();
    const clock = takeTime(host);
    let count = 0;
    const tick = () => {
      count++;
      host.requestAnimationFrame(tick);
    };
    host.requestAnimationFrame(tick);
    clock.step(16);
    clock.step(16);
    expect(count).toBe(2);
  });

  it("gives the page its clock back, never behind what it was told, its waiting timers and frames moved onto it", () => {
    const { host, pass, realTimers, realFrames } = standIn();
    const clock = takeTime(host);
    const fired: string[] = [];
    host.setTimeout(() => fired.push("timer"), 100);
    const cancelled = host.setTimeout(() => fired.push("cancelled"), 100);
    clock.step(40);
    host.requestAnimationFrame(() => fired.push("frame"));
    pass(2000);
    clock.release();
    // Real time ran ahead while the take was made: the page carries on from it.
    expect(host.performance.now()).toBe(3000);
    // The timers still due went on the page's own clock with what was left (60 ms), the frame too.
    expect(realTimers.map((t) => t.at)).toEqual([3060, 3060]);
    expect(realFrames).toHaveLength(1);
    host.clearTimeout(cancelled);
    for (const timer of [...realTimers]) timer.run();
    realFrames[0].run(0);
    expect(fired).toEqual(["timer", "frame"]);
  });

  it("never takes the page's own timers for its own, nor its own for the page's", () => {
    const { host, realTimers } = standIn();
    const own = host.setTimeout(() => {}, 50);
    const clock = takeTime(host);
    const ours = host.setTimeout(() => {}, 50);
    expect(ours).not.toBe(own);
    host.clearTimeout(own);
    expect(realTimers).toHaveLength(0);
    clock.release();
  });
});

/**
 * A video as a browser keeps one: really paused or playing, a seek told by "seeked" a moment later,
 * and its events heard first by the window's capture listeners, as on a page.
 */
function videos() {
  const capturing = new Map<string, Set<(event: Event) => void>>();
  const window = {
    addEventListener: (type: string, listener: (event: Event) => void) => void capturing.set(type, (capturing.get(type) ?? new Set()).add(listener)),
    removeEventListener: (type: string, listener: (event: Event) => void) => void capturing.get(type)?.delete(listener),
  };
  class Video extends EventTarget {
    override dispatchEvent(event: Event) {
      for (const listener of capturing.get(event.type) ?? []) listener(Object.defineProperty(event, "target", { value: this, configurable: true }));
      return event.cancelBubble ? true : super.dispatchEvent(event);
    }
    #paused = true;
    #time = 0;
    duration = 10;
    readyState = 4;
    loop = false;
    playbackRate = 1;
    srcObject: object | null = null;
    seeks = 0;
    get paused() {
      return this.#paused;
    }
    get ended() {
      return !this.loop && this.#time >= this.duration;
    }
    get currentTime() {
      return this.#time;
    }
    set currentTime(time: number) {
      this.#time = time;
      this.seeks++;
      queueMicrotask(() => this.dispatchEvent(new Event("seeked")));
    }
    play() {
      if (this.#paused) {
        this.#paused = false;
        queueMicrotask(() => ["play", "playing"].forEach((type) => this.dispatchEvent(new Event(type))));
      }
      return Promise.resolve();
    }
    pause() {
      if (!this.#paused) {
        this.#paused = true;
        queueMicrotask(() => this.dispatchEvent(new Event("pause")));
      }
    }
  }
  const page: Video[] = [];
  /** A video on the page, and every event the page hears from it. */
  const add = () => {
    const video = new Video();
    page.push(video);
    const heard: string[] = [];
    for (const type of ["play", "playing", "pause", "ended"]) video.addEventListener(type, () => heard.push(type));
    return { video, heard };
  };
  const really = (video: Video) => Object.getOwnPropertyDescriptor(Video.prototype, "paused")!.get!.call(video) as boolean;
  return { Video, add, page, really, window };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("takeTime, with videos playing", () => {
  const withVideos = () => {
    const { host, ...rest } = standIn();
    const media = videos();
    const realPaused = Object.getOwnPropertyDescriptor(media.Video.prototype, "paused")!;
    Object.assign(host, {
      HTMLMediaElement: media.Video as unknown as { prototype: HTMLMediaElement },
      document: { querySelectorAll: () => media.page },
      ...media.window,
    });
    return { host, ...rest, ...media, really: (video: InstanceType<typeof media.Video>) => realPaused.get!.call(video) as boolean };
  };

  it("holds one playing: paused for real, playing to the page, moved on by each step before the frame that draws it", async () => {
    const { host, add, really } = withVideos();
    const { video, heard } = add();
    await video.play();
    await flush();
    heard.length = 0;
    const clock = takeTime(host);
    expect(really(video)).toBe(true);
    expect(video.paused).toBe(false);
    const drawn: number[] = [];
    host.requestAnimationFrame(() => drawn.push(video.currentTime));
    await clock.step(500);
    expect(video.currentTime).toBeCloseTo(0.5);
    expect(drawn).toEqual([0.5]);
    await flush();
    // The real pause it took never reached the page.
    expect(heard).toEqual([]);
    clock.release();
  });

  it("holds one played during the take, lets one paused go, and loops or ends one at its end", async () => {
    const { host, add, really } = withVideos();
    const clock = takeTime(host);
    const played = add();
    await played.video.play();
    await flush();
    expect(played.heard).toEqual(["play", "playing"]);
    expect(really(played.video)).toBe(true);
    await clock.step(250);
    expect(played.video.currentTime).toBeCloseTo(0.25);
    played.video.pause();
    await flush();
    expect(played.heard).toEqual(["play", "playing", "pause"]);
    await clock.step(250);
    expect(played.video.currentTime).toBeCloseTo(0.25);

    const looping = add();
    looping.video.loop = true;
    looping.video.currentTime = 9.9;
    const ending = add();
    ending.video.currentTime = 9.9;
    await looping.video.play();
    await ending.video.play();
    await clock.step(200);
    await flush();
    expect(looping.video.currentTime).toBeCloseTo(0.1);
    expect(looping.video.paused).toBe(false);
    expect(ending.video.currentTime).toBe(10);
    expect(ending.video.paused).toBe(true);
    expect(ending.heard).toEqual(["play", "playing", "pause", "ended"]);
    clock.release();
  });

  it("gives back what it held playing for real, unheard, and leaves a live stream alone", async () => {
    const { host, add, really, Video } = withVideos();
    const play = Video.prototype.play;
    const { video, heard } = add();
    const stream = add();
    stream.video.srcObject = {};
    await video.play();
    await stream.video.play();
    await flush();
    heard.length = 0;
    const clock = takeTime(host);
    expect(really(stream.video)).toBe(false);
    await clock.step(100);
    expect(stream.video.seeks).toBe(0);
    clock.release();
    await flush();
    expect(Video.prototype.play).toBe(play);
    expect(really(video)).toBe(false);
    expect(video.paused).toBe(false);
    expect(heard).toEqual([]);
  });
});
