import { describe, expect, it } from "vitest";

import { avcCodec, evenSize } from "./encoder.ts";

describe("avcCodec", () => {
  it("names H.264's High profile at the lowest level that holds the take's frames, as many a second, at its bitrate", () => {
    // 2 macroblocks: level 3.0.
    expect(avcCodec(32, 16, 60, 1_000_000)).toBe("avc1.64001e");
    // A 1440 by 810 frame (90 by 51 macroblocks) 60 times a second is past level 4.1's 245,760 a second: 4.2.
    expect(avcCodec(1440, 810, 60, 12_000_000)).toBe("avc1.64002a");
    // Twice that across (Retina): 18,360 macroblocks a frame, 1.1 million a second, only 5.2 holds.
    expect(avcCodec(2880, 1620, 60, 40_000_000)).toBe("avc1.640034");
    expect(avcCodec(3840, 2160, 60, 40_000_000)).toBe("avc1.640034");
  });

  it("goes up a level for the bitrate when the size alone wouldn't need it", () => {
    // 3.0 allows 12.5 Mbit/s in High; 40 needs 4.1.
    expect(avcCodec(640, 360, 30, 12_000_000)).toBe("avc1.64001e");
    expect(avcCodec(640, 360, 30, 40_000_000)).toBe("avc1.640029");
  });

  it("holds a frame's sides to the level's, so a long thin one goes up too", () => {
    // 256 by 1 macroblocks: few, but a side √(8 × 8,192) = 256 macroblocks long needs 4.0 at least.
    expect(avcCodec(4096, 16, 30, 1_000_000)).toBe("avc1.640028");
  });

  it("has nothing past H.264's largest frame", () => {
    expect(avcCodec(9000, 5000, 60, 40_000_000)).toBeNull();
  });
});

describe("evenSize", () => {
  it("takes the last column or row off an odd frame, as H.264's colour needs", () => {
    expect(evenSize({ width: 1001, height: 563 })).toEqual({ width: 1000, height: 562 });
    expect(evenSize({ width: 1440, height: 810 })).toEqual({ width: 1440, height: 810 });
  });
});
