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
