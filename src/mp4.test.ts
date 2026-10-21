import { describe, expect, it } from "vitest";

import { defragment, isFragmented } from "./mp4.ts";

/** A box: its size and type, then what's in it. */
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const chars = (s: string) => [...s].map((c) => c.charCodeAt(0));
const box = (type: string, ...parts: number[][]) => {
  const body = parts.flat();
  return [...u32(8 + body.length), ...chars(type), ...body];
};
const full = (type: string, version: number, flags: number, ...parts: number[][]) => box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

/** A track's header boxes as a browser's recorder writes them: no samples listed, a duration of 0. */
function trak(id: number, timescale: number, handler: "vide" | "soun") {
  return box(
    "trak",
    full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(0), new Array(60).fill(0)),
    box(
      "mdia",
      full("mdhd", 0, 0, u32(0), u32(0), u32(timescale), u32(0), u16(0x55c4), u16(0)),
      full("hdlr", 0, 0, u32(0), chars(handler), u32(0), u32(0), u32(0), [0]),
      box(
        "minf",
        handler === "vide" ? full("vmhd", 0, 1, new Array(8).fill(0)) : full("smhd", 0, 0, u32(0)),
        box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
        box(
          "stbl",
          full("stsd", 0, 0, u32(1), box(handler === "vide" ? "avc1" : "mp4a", new Array(16).fill(id))),
          full("stts", 0, 0, u32(0)),
          full("stsc", 0, 0, u32(0)),
          full("stsz", 0, 0, u32(0), u32(0)),
          full("stco", 0, 0, u32(0)),
        ),
      ),
    ),
  );
}

type FragmentSample = { duration: number; size: number; sync: boolean; fill: number };

/**
 * A fragmented MP4 of two tracks, as a recorder writes one: a header, then a moof and mdat
 * per fragment, the moof's runs pointing into the mdat after it from the moof's start.
 */
function fragmented(fragments: { track: number; time: number; samples: FragmentSample[] }[][]) {
  const head = [
    ...box("ftyp", chars("isom"), u32(512), chars("isom"), chars("iso6")),
    ...box(
      "moov",
      full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(0), new Array(76).fill(0), u32(3)),
      trak(1, 90000, "vide"),
      trak(2, 48000, "soun"),
      box("mvex", full("trex", 0, 0, u32(1), u32(1), u32(0), u32(0), u32(0)), full("trex", 0, 0, u32(2), u32(1), u32(1024), u32(0), u32(0))),
    ),
  ];
  const out = [...head];
  for (const fragment of fragments) {
    // Measured once with offsets of 0, then written for real: the sizes don't change.
    const moofOf = (offsets: number[]) =>
      box(
        "moof",
        full("mfhd", 0, 0, u32(1)),
        ...fragment.map((traf, k) =>
          box(
            "traf",
            full("tfhd", 0, 0x020000, u32(traf.track)),
            full("tfdt", 1, 0, u32(0), u32(traf.time)),
            full("trun", 0, 0x01 | 0x100 | 0x200 | 0x400, u32(traf.samples.length), u32(offsets[k]), ...traf.samples.map((s) => [...u32(s.duration), ...u32(s.size), ...u32(s.sync ? 0 : 0x10000)])),
          ),
        ),
      );
    const moofSize = moofOf(fragment.map(() => 0)).length;
    const offsets: number[] = [];
    let at = moofSize + 8;
    for (const traf of fragment) {
      offsets.push(at);
      at += traf.samples.reduce((total, s) => total + s.size, 0);
    }
    out.push(...moofOf(offsets), ...box("mdat", fragment.flatMap((traf) => traf.samples.flatMap((s) => new Array(s.size).fill(s.fill)))));
  }
  return new Uint8Array(out);
}

/** The boxes of an MP4 by path, read back for checking. */
function parse(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const walk = (start: number, end: number): { type: string; start: number; end: number; body: number }[] => {
    const out = [];
    for (let at = start; at + 8 <= end; ) {
      const size = view.getUint32(at);
      const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
      out.push({ type, start: at, end: at + size, body: at + 8 });
      at += size;
    }
    return out;
  };
  const find = (path: string[], from = walk(0, bytes.length)): { type: string; start: number; end: number; body: number }[] => {
    const [first, ...rest] = path;
    const matches = from.filter((b) => b.type === first);
    return rest.length ? matches.flatMap((b) => find(rest, walk(b.body, b.end))) : matches;
  };
  return { view, walk, find, top: walk(0, bytes.length) };
}

const VIDEO = [
  { duration: 1500, size: 10, sync: true, fill: 1 },
  { duration: 1500, size: 12, sync: false, fill: 2 },
  { duration: 1500, size: 9, sync: false, fill: 3 },
];
const AUDIO = [
  { duration: 1024, size: 4, sync: true, fill: 7 },
  { duration: 1024, size: 4, sync: true, fill: 8 },
];

describe("defragment", () => {
  // The audio starts a twentieth of a second after the video; between the fragments the video skips 1500 ticks.
  const input = fragmented([
    [
      { track: 1, time: 0, samples: VIDEO },
      { track: 2, time: 2400, samples: AUDIO },
    ],
    [
      { track: 1, time: 6000, samples: [{ duration: 1500, size: 11, sync: true, fill: 4 }] },
      { track: 2, time: 4448, samples: [{ duration: 1024, size: 4, sync: true, fill: 9 }] },
    ],
  ]);

  it("knows a fragmented MP4 from a regular one", () => {
    expect(isFragmented(input)).toBe(true);
    expect(isFragmented(defragment(input)!)).toBe(false);
    expect(isFragmented(new Uint8Array([1, 2, 3]))).toBe(false);
  });

  it("puts one moov before the samples, which keep every byte, in order, track by track", () => {
    const output = defragment(input)!;
    const { top, find, view } = parse(output);
    expect(top.map((b) => b.type)).toEqual(["ftyp", "moov", "mdat"]);
    expect(find(["moov", "mvex"])).toHaveLength(0);
    const offsets = find(["moov", "trak", "mdia", "minf", "stbl", "stco"]).map((b) => view.getUint32(b.body + 8));
    const sizes = find(["moov", "trak", "mdia", "minf", "stbl", "stsz"]).map((b) => Array.from({ length: view.getUint32(b.body + 8) }, (_, k) => view.getUint32(b.body + 12 + 4 * k)));
    expect(sizes).toEqual([
      [10, 12, 9, 11],
      [4, 4, 4],
    ]);
    // Each chunk starts in the mdat and holds its track's samples as they were.
    expect(Array.from(output.subarray(offsets[0], offsets[0] + 42))).toEqual([...new Array(10).fill(1), ...new Array(12).fill(2), ...new Array(9).fill(3), ...new Array(11).fill(4)]);
    expect(Array.from(output.subarray(offsets[1], offsets[1] + 12))).toEqual([...new Array(4).fill(7), ...new Array(4).fill(8), ...new Array(4).fill(9)]);
    expect(offsets[0]).toBe(find(["mdat"])[0].body);
  });

  it("says how long every sample lasts, a gap held by the sample before it, and which can start a decode", () => {
    const { find, view } = parse(defragment(input)!);
    const [videoStts] = find(["moov", "trak", "mdia", "minf", "stbl", "stts"]);
    const entries = Array.from({ length: view.getUint32(videoStts.body + 4) }, (_, k) => [view.getUint32(videoStts.body + 8 + 8 * k), view.getUint32(videoStts.body + 12 + 8 * k)]);
    // 4500 ticks of samples, then the next fragment at 6000: the third sample holds 3000.
    expect(entries).toEqual([
      [2, 1500],
      [1, 3000],
      [1, 1500],
    ]);
    const [stss] = find(["moov", "trak", "mdia", "minf", "stbl", "stss"]);
    expect([view.getUint32(stss.body + 4), view.getUint32(stss.body + 8), view.getUint32(stss.body + 12)]).toEqual([2, 1, 4]);
    // Audio: every sample a sync sample, so no list of them.
    expect(find(["moov", "trak", "mdia", "minf", "stbl", "stss"])).toHaveLength(1);
  });

  it("says how long the take is, and starts a late track late", () => {
    const { find, view } = parse(defragment(input)!);
    // As long as its last track: the audio, 50 ms late and 3072 ticks at 48000 a second long (the video is 83 ms).
    const [mvhd] = find(["moov", "mvhd"]);
    expect(view.getUint32(mvhd.body + 16)).toBe(Math.round(((2400 + 3072) / 48000) * 1000));
    const tkhds = find(["moov", "trak", "tkhd"]).map((b) => view.getUint32(b.body + 20));
    expect(tkhds).toEqual([Math.round((7500 / 90000) * 1000), 114]);
    const mdhds = find(["moov", "trak", "mdia", "mdhd"]).map((b) => view.getUint32(b.body + 16));
    expect(mdhds).toEqual([7500, 3072]);
    // The audio starts 2400 ticks (50 ms) in: an empty edit first.
    const [elst] = find(["moov", "trak", "edts", "elst"]);
    expect(view.getUint32(elst.body + 4)).toBe(2);
    expect(view.getUint32(elst.body + 8)).toBe(50);
    expect(view.getInt32(elst.body + 12)).toBe(-1);
    expect(find(["moov", "trak", "edts"])).toHaveLength(1);
  });

  it("leaves alone what it doesn't understand", () => {
    expect(defragment(new Uint8Array(64))).toBeNull();
    const regular = defragment(input)!;
    expect(defragment(regular)).toBeNull();
    // Cut short: a sample runs past the end.
    expect(defragment(input.subarray(0, input.length - 3))).toBeNull();
  });
});
