import { describe, expect, it } from "vitest";

import { clock, endAt, gifFrames, gifSize, isEdited, lengthOf, SHORTEST, startAt, whole } from "./edit.ts";
import { changed, CLEAR, GifWriter, Indexer, lzw, paletteOf } from "./gif.ts";

/** GIF's LZW read back: a code stream of `minCodeSize` to indices, as a decoder does it. */
function unlzw(data: Uint8Array, minCodeSize = 8): number[] {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let size = minCodeSize + 1;
  let table: number[][] = [];
  const reset = () => {
    table = Array.from({ length: clear + 2 }, (_, k) => (k < clear ? [k] : []));
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bits = 0;
  let held = 0;
  let p = 0;
  let previous: number[] | null = null;
  for (;;) {
    while (held < size && p < data.length) {
      bits |= data[p++] << held;
      held += 8;
    }
    if (held < size) break;
    const code = bits & ((1 << size) - 1);
    bits >>>= size;
    held -= size;
    if (code === clear) {
      reset();
      previous = null;
      continue;
    }
    if (code === end) break;
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (previous) entry = [...previous, previous[0]];
    else throw new Error("a code before its entry");
    out.push(...entry);
    if (previous && table.length < 4096) table.push([...previous, entry[0]]);
    previous = entry;
    if (table.length === 1 << size && size < 12) size++;
  }
  return out;
}

/** A GIF read back into its frames: where each is, how long it shows, and every screen it leaves. */
function decode(gif: Uint8Array) {
  const view = new DataView(gif.buffer, gif.byteOffset, gif.byteLength);
  expect(String.fromCharCode(...gif.subarray(0, 6))).toBe("GIF89a");
  const width = view.getUint16(6, true);
  const height = view.getUint16(8, true);
  const table = gif.subarray(13, 13 + 768);
  let p = 13 + 768;
  const screen = new Array<number>(width * height).fill(-1);
  const frames: { x: number; y: number; width: number; height: number; delay: number; screen: number[] }[] = [];
  let delay = 0;
  let clear = -1;
  let loops = false;
  for (;;) {
    const kind = gif[p++];
    if (kind === 0x3b) break;
    if (kind === 0x21) {
      const label = gif[p++];
      if (label === 0xf9) {
        delay = view.getUint16(p + 2, true);
        clear = gif[p + 1] & 1 ? gif[p + 4] : -1;
      }
      if (label === 0xff && String.fromCharCode(...gif.subarray(p + 1, p + 12)) === "NETSCAPE2.0") loops = true;
      while (gif[p] !== 0) p += gif[p] + 1;
      p++;
      continue;
    }
    expect(kind).toBe(0x2c);
    const x = view.getUint16(p, true);
    const y = view.getUint16(p + 2, true);
    const w = view.getUint16(p + 4, true);
    const h = view.getUint16(p + 6, true);
    p += 9;
    const minCodeSize = gif[p++];
    const data: number[] = [];
    while (gif[p] !== 0) {
      data.push(...gif.subarray(p + 1, p + 1 + gif[p]));
      p += gif[p] + 1;
    }
    p++;
    const indices = unlzw(Uint8Array.from(data), minCodeSize);
    expect(indices).toHaveLength(w * h);
    indices.forEach((index, k) => {
      if (index !== clear) screen[(y + Math.floor(k / w)) * width + x + (k % w)] = index;
    });
    frames.push({ x, y, width: w, height: h, delay, screen: [...screen] });
  }
  return { width, height, table, frames, loops };
}

describe("lzw", () => {
  it("is read back as written, short or long, all one index or every one", () => {
    const cases = [
      new Uint8Array([]),
      new Uint8Array([7]),
      new Uint8Array(5000).fill(3),
      Uint8Array.from({ length: 20_000 }, (_, k) => (k * 7919) % 251),
      Uint8Array.from({ length: 30_000 }, (_, k) => ((k >> 4) ^ (k >> 9)) & 255),
    ];
    for (const indices of cases) expect(unlzw(lzw(indices))).toEqual([...indices]);
  });

  it("compresses what repeats", () => {
    expect(lzw(new Uint8Array(100_000).fill(1)).length).toBeLessThan(2000);
  });
});

describe("paletteOf", () => {
  it("keeps every colour of a frame with few of them", () => {
    const frame = new Uint8ClampedArray([255, 255, 255, 255, 10, 20, 30, 255, 255, 255, 255, 255]);
    const palette = paletteOf([frame]);
    expect(palette.length).toBe(6);
    expect([...palette]).toEqual(expect.arrayContaining([255, 10, 20, 30]));
  });

  it("keeps the most used colours exactly, and covers a gradient with steps", () => {
    const width = 512;
    const frame = new Uint8ClampedArray(width * 64 * 4);
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < width; x++) {
        const p = 4 * (y * width + x);
        // A page: white, with a block of brand blue, and a grey gradient band.
        const [r, g, b] = y < 40 ? (x > 100 && x < 200 ? [10, 132, 255] : [255, 255, 255]) : [x >> 1, x >> 1, x >> 1];
        frame.set([r, g, b, 255], p);
      }
    const palette = paletteOf([frame]);
    expect(palette.length).toBeLessThanOrEqual(255 * 3);
    const indexer = new Indexer(palette);
    const exact = (r: number, g: number, b: number) => {
      const k = indexer.nearest(r, g, b);
      return [palette[3 * k], palette[3 * k + 1], palette[3 * k + 2]];
    };
    expect(exact(255, 255, 255)).toEqual([255, 255, 255]);
    expect(exact(10, 132, 255)).toEqual([10, 132, 255]);
    // Every grey of the gradient within a few levels of one in the palette.
    for (let v = 0; v < 256; v += 5) expect(Math.abs(exact(v, v, v)[0] - v)).toBeLessThanOrEqual(3);
  });
});

describe("Indexer", () => {
  it("maps each pixel to its nearest colour, the same colour always the same way", () => {
    const palette = Uint8Array.from([0, 0, 0, 255, 255, 255, 255, 0, 0]);
    const indexer = new Indexer(palette);
    const pixels = new Uint8ClampedArray([2, 1, 3, 255, 250, 252, 255, 255, 240, 10, 12, 255, 2, 1, 3, 255]);
    expect([...indexer.indices(pixels)]).toEqual([0, 1, 2, 0]);
  });
});

describe("changed", () => {
  it("is the whole frame at first, then only the rectangle round what changed, the rest see-through", () => {
    const before = Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
    expect(changed(null, before, 4, 3)).toEqual({ x: 0, y: 0, width: 4, height: 3, indices: before });
    expect(changed(before, before.slice(), 4, 3)).toBeNull();
    const after = before.slice();
    after[5] = 2;
    after[10] = 3;
    const patch = changed(before, after, 4, 3)!;
    expect(patch).toMatchObject({ x: 1, y: 1, width: 2, height: 2 });
    expect([...patch.indices]).toEqual([2, CLEAR, CLEAR, 3]);
  });
});

describe("GifWriter", () => {
  it("writes frames that read back as drawn, held longer when nothing changed, looping", () => {
    const width = 6;
    const height = 4;
    const palette = Uint8Array.from([255, 255, 255, 10, 132, 255, 0, 0, 0]);
    const writer = new GifWriter(width, height, palette);
    const first = new Uint8Array(width * height);
    const second = first.slice();
    second[7] = 1;
    second[8] = 2;
    writer.frame(first, 7);
    writer.frame(second, 6);
    writer.frame(second.slice(), 7);
    const third = second.slice();
    third[23] = 2;
    writer.frame(third, 7);
    const gif = decode(writer.done());
    expect(gif).toMatchObject({ width, height, loops: true });
    expect([...gif.table.subarray(0, 9)]).toEqual([...palette]);
    // The unchanged frame held the one before it longer: three frames, not four.
    expect(gif.frames.map((frame) => frame.delay)).toEqual([7, 13, 7]);
    expect(gif.frames[1]).toMatchObject({ x: 1, y: 1, width: 2, height: 1 });
    expect(gif.frames.map((frame) => frame.screen)).toEqual([[...first], [...second], [...third]]);
  });
});

describe("an edit", () => {
  it("starts as the whole take, and knows when it's been changed", () => {
    expect(whole(8)).toEqual({ from: 0, to: 8, speed: 1 });
    expect(isEdited(whole(8), 8)).toBe(false);
    expect(isEdited({ from: 0.5, to: 8, speed: 1 }, 8)).toBe(true);
    expect(isEdited({ from: 0, to: 8, speed: 2 }, 8)).toBe(true);
  });

  it("keeps its ends in the take and apart", () => {
    const edit = whole(8);
    expect(startAt(edit, -3).from).toBe(0);
    expect(startAt({ ...edit, to: 2 }, 5).from).toBeCloseTo(2 - SHORTEST, 9);
    expect(endAt(edit, 12, 8).to).toBe(8);
    expect(endAt({ ...edit, from: 6 }, 1, 8).to).toBeCloseTo(6 + SHORTEST, 9);
  });

  it("lasts as long as it's trimmed to, played at its speed", () => {
    expect(lengthOf({ from: 1, to: 5, speed: 2 })).toBe(2);
    expect(lengthOf({ from: 1, to: 5, speed: 0.5 })).toBe(8);
  });

  it("says which moments of the take a GIF shows, the delays adding up to its length", () => {
    const frames = gifFrames({ from: 1, to: 3, speed: 2 }, 15);
    expect(frames).toHaveLength(15);
    expect(frames[0].at).toBe(1);
    expect(frames[1].at).toBeCloseTo(1 + 2 / 15, 9);
    expect(frames.reduce((total, frame) => total + frame.delay, 0)).toBe(100);
    for (const frame of frames) expect([6, 7]).toContain(frame.delay);
  });

  it("reads as a clock, and a GIF is sized down to fit", () => {
    expect(clock(4.24)).toBe("0:04.2");
    expect(clock(75)).toBe("1:15.0");
    expect(gifSize(1600, 900)).toEqual({ width: 800, height: 450 });
    expect(gifSize(400, 300)).toEqual({ width: 400, height: 300 });
  });
});
