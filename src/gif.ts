/**
 * An animated GIF from frames of pixels: one palette for the whole take (its most used colours
 * exactly, then a median cut of the rest), each frame only where it changed from the one before
 * (the rest left see-through, so it compresses to almost nothing), LZW as GIF wants it, looping
 * forever. Pure and plain: no canvas, no worker; the export feeds it frames.
 */

/** The palette's see-through entry: frames after the first leave unchanged pixels to it. */
export const CLEAR = 255;
/** Colours a palette holds besides it. */
const COLOURS = 255;
/** Colours kept exactly, the most used first: a page's flat backgrounds, text and controls. */
const EXACT = 96;
/** The most pixels read to make a palette: plenty to know a take's colours, few enough to be quick. */
const SAMPLES = 250_000;

const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;

/**
 * A palette of up to 255 colours for frames of RGBA pixels: the most used colours exactly (as
 * many as `EXACT`), then the rest of the room filled by a median cut of every other colour, so
 * flat parts stay exact and gradients still get enough steps. Returned as r, g, b triples.
 */
export function paletteOf(frames: Uint8ClampedArray[]): Uint8Array {
  const total = frames.reduce((sum, frame) => sum + frame.length / 4, 0);
  const step = Math.max(1, Math.floor(total / SAMPLES));
  const counts = new Map<number, number>();
  for (const frame of frames) {
    for (let p = 0; p < frame.length; p += 4 * step) {
      const colour = pack(frame[p], frame[p + 1], frame[p + 2]);
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
  }
  const byUse = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (byUse.length <= COLOURS) return triples(byUse.map(([colour]) => colour));
  const exact = byUse.slice(0, EXACT).map(([colour]) => colour);
  // The rest, each as often as it was seen (to a point), cut into boxes of similar colours.
  const rest: number[] = [];
  for (const [colour, count] of byUse.slice(EXACT)) for (let k = 0; k < Math.min(count, 16); k++) rest.push(colour);
  return triples([...exact, ...medianCut(Uint32Array.from(rest), COLOURS - exact.length)]);
}

function triples(colours: number[]) {
  const out = new Uint8Array(colours.length * 3);
  colours.forEach((colour, k) => out.set([(colour >> 16) & 255, (colour >> 8) & 255, colour & 255], k * 3));
  return out;
}

const channel = (colour: number, shift: number) => (colour >> shift) & 255;

/** Median cut: `colours` boxes, each split across its widest channel at its median, then averaged. */
function medianCut(samples: Uint32Array, colours: number): number[] {
  type Range = { start: number; end: number; spread: number; shift: number };
  const measure = (start: number, end: number): Range => {
    let best = { spread: -1, shift: 16 };
    for (const shift of [16, 8, 0]) {
      let low = 255;
      let high = 0;
      for (let k = start; k < end; k++) {
        const value = channel(samples[k], shift);
        if (value < low) low = value;
        if (value > high) high = value;
      }
      if (high - low > best.spread) best = { spread: high - low, shift };
    }
    return { start, end, ...best };
  };
  const boxes: Range[] = [measure(0, samples.length)];
  while (boxes.length < colours) {
    // The widest box with more than one colour in it.
    let pick = -1;
    for (let k = 0; k < boxes.length; k++) if (boxes[k].spread > 0 && (pick < 0 || boxes[k].spread > boxes[pick].spread)) pick = k;
    if (pick < 0) break;
    const box = boxes[pick];
    const slice = samples.subarray(box.start, box.end);
    slice.sort((a, b) => channel(a, box.shift) - channel(b, box.shift));
    let middle = box.start + (slice.length >> 1);
    // Not inside a run of one value: the two halves shouldn't share a colour.
    const at = channel(samples[middle], box.shift);
    while (middle > box.start + 1 && channel(samples[middle - 1], box.shift) === at) middle--;
    if (middle <= box.start) middle = box.start + 1;
    boxes.splice(pick, 1, measure(box.start, middle), measure(middle, box.end));
  }
  return boxes.map(({ start, end }) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let k = start; k < end; k++) {
      r += channel(samples[k], 16);
      g += channel(samples[k], 8);
      b += channel(samples[k], 0);
    }
    const n = Math.max(1, end - start);
    return pack(Math.round(r / n), Math.round(g / n), Math.round(b / n));
  });
}

/**
 * Finds each pixel's nearest palette colour, remembering the answer for colours alike (to 6
 * bits a channel), so a frame costs a lookup a pixel once its colours have been seen.
 */
export class Indexer {
  private readonly cache = new Int16Array(1 << 18).fill(-1);
  private readonly count: number;

  constructor(private readonly palette: Uint8Array) {
    this.count = palette.length / 3;
  }

  /** The palette entry nearest a colour. */
  nearest(r: number, g: number, b: number) {
    let best = 0;
    let bestDistance = Infinity;
    const p = this.palette;
    for (let k = 0; k < this.count; k++) {
      const dr = p[3 * k] - r;
      const dg = p[3 * k + 1] - g;
      const db = p[3 * k + 2] - b;
      // Weighted as eyes are: green most, blue least.
      const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = k;
        if (distance === 0) break;
      }
    }
    return best;
  }

  /** A frame of RGBA pixels as palette indices. */
  indices(pixels: Uint8ClampedArray): Uint8Array {
    const out = new Uint8Array(pixels.length / 4);
    const cache = this.cache;
    for (let k = 0, p = 0; k < out.length; k++, p += 4) {
      const r = pixels[p];
      const g = pixels[p + 1];
      const b = pixels[p + 2];
      const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
      let index = cache[key];
      if (index < 0) {
        // Decided for the middle of the cell, so the same colour always gets the same entry.
        index = cache[key] = this.nearest((r & 0xfc) | 2, (g & 0xfc) | 2, (b & 0xfc) | 2);
      }
      out[k] = index;
    }
    return out;
  }
}

/** A rectangle of a frame and its indices, unchanged pixels see-through. */
export type Patch = { x: number; y: number; width: number; height: number; indices: Uint8Array };

/**
 * What changed between two frames of indices, `width` wide: the smallest rectangle round every
 * pixel that did, the ones inside it that didn't left see-through. Null when nothing changed.
 * Without a frame before, the whole frame.
 */
export function changed(before: Uint8Array | null, after: Uint8Array, width: number, height: number): Patch | null {
  if (!before) return { x: 0, y: 0, width, height, indices: after };
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (before[row + x] !== after[row + x]) {
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x < left) left = x;
        if (x > right) right = x;
      }
    }
  }
  if (bottom < 0) return null;
  const w = right - left + 1;
  const h = bottom - top + 1;
  const indices = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (top + y) * width + left;
    for (let x = 0; x < w; x++) indices[y * w + x] = before[row + x] === after[row + x] ? CLEAR : after[row + x];
  }
  return { x: left, y: top, width: w, height: h, indices };
}

/** Bytes written as they come, growing as needed. */
class Bytes {
  data = new Uint8Array(1 << 16);
  length = 0;

  push(...values: number[]) {
    this.room(values.length);
    for (const value of values) this.data[this.length++] = value;
  }

  add(bytes: Uint8Array) {
    this.room(bytes.length);
    this.data.set(bytes, this.length);
    this.length += bytes.length;
  }

  u16(value: number) {
    this.push(value & 255, (value >> 8) & 255);
  }

  room(n: number) {
    if (this.length + n <= this.data.length) return;
    let size = this.data.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.data.subarray(0, this.length));
    this.data = next;
  }

  done() {
    return this.data.slice(0, this.length);
  }
}

/**
 * Codes for (prefix, index) pairs, made once and kept: an entry counts only while its stamp is
 * the current table's, so a new table is a new stamp rather than 8 MB written again.
 */
let codes: Int32Array | null = null;
let stamps: Int32Array | null = null;
let stamp = 0;

/**
 * GIF's LZW: indices of `minCodeSize` bits as a code stream (variable code width from one bit
 * more, cleared at 4096 codes), least significant bit first. Without the sub-block framing.
 */
export function lzw(indices: Uint8Array, minCodeSize = 8): Uint8Array {
  const out = new Bytes();
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let next = end + 1;
  let size = minCodeSize + 1;
  let bits = 0;
  let held = 0;
  codes ??= new Int32Array(4096 << 8);
  stamps ??= new Int32Array(4096 << 8);
  const table = codes;
  const seen = stamps;
  stamp++;
  const emit = (code: number) => {
    bits |= code << held;
    held += size;
    while (held >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      held -= 8;
    }
  };
  emit(clear);
  if (!indices.length) {
    emit(end);
    if (held > 0) out.push(bits & 255);
    return out.done();
  }
  let prefix = indices[0];
  for (let k = 1; k < indices.length; k++) {
    const index = indices[k];
    const key = (prefix << 8) | index;
    if (seen[key] === stamp) {
      prefix = table[key];
      continue;
    }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = end + 1;
      size = minCodeSize + 1;
      stamp++;
    } else {
      if (next >= 1 << size) size++;
      table[key] = next++;
      seen[key] = stamp;
    }
    prefix = index;
  }
  emit(prefix);
  emit(end);
  if (held > 0) out.push(bits & 255);
  return out.done();
}

/**
 * Writes an animated GIF a frame at a time: the screen and palette first, looping forever, then
 * each frame where it changed and how long it shows (hundredths of a second), kept back a frame
 * so one that changes nothing just shows the last one longer.
 */
export class GifWriter {
  private readonly out = new Bytes();
  private before: Uint8Array | null = null;
  private pending: { patch: Patch; delay: number } | null = null;

  constructor(
    readonly width: number,
    readonly height: number,
    palette: Uint8Array,
  ) {
    const out = this.out;
    out.push(...[..."GIF89a"].map((c) => c.charCodeAt(0)));
    out.u16(width);
    out.u16(height);
    // A global colour table of 256 entries, 8 bits of colour.
    out.push(0xf7, 0, 0);
    const table = new Uint8Array(256 * 3);
    table.set(palette.subarray(0, Math.min(palette.length, COLOURS * 3)));
    out.add(table);
    // Loops forever (Netscape's application extension).
    out.push(0x21, 0xff, 0x0b, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00);
  }

  /** The next frame, as palette indices for the whole screen, and how long it shows. */
  frame(indices: Uint8Array, delay: number) {
    const patch = changed(this.before, indices, this.width, this.height);
    this.before = indices;
    if (!patch) {
      if (this.pending) this.pending.delay += delay;
      return;
    }
    this.flush();
    this.pending = { patch, delay };
  }

  /** The GIF, its last frame written. */
  done() {
    this.flush();
    this.out.push(0x3b);
    return this.out.done();
  }

  private flush() {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    const { patch, delay } = pending;
    const out = this.out;
    // Graphic control: left in place for the next frame to draw over, see-through where it's CLEAR.
    out.push(0x21, 0xf9, 0x04, (1 << 2) | 1);
    out.u16(Math.max(2, Math.round(delay)));
    out.push(CLEAR, 0);
    out.push(0x2c);
    out.u16(patch.x);
    out.u16(patch.y);
    out.u16(patch.width);
    out.u16(patch.height);
    out.push(0, 8);
    const data = lzw(patch.indices, 8);
    for (let at = 0; at < data.length; at += 255) {
      const block = data.subarray(at, at + 255);
      out.push(block.length);
      out.add(block);
    }
    out.push(0);
  }
}
