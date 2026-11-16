/**
 * A fragmented MP4, as browsers record one, made a regular one: the same samples, untouched,
 * indexed in one `moov` before them with the take's length. Recorded, a take is a header that
 * says nothing about its samples followed by fragments, each saying what it holds; players can't
 * seek in it and some can't say how long it is. Regular, it seeks anywhere and plays everywhere.
 * Pure: bytes in, bytes out; null for anything it doesn't understand, so the take stays as it was.
 */

type Box = { type: string; start: number; end: number; body: number };

const text = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** The boxes between `start` and `end`, in order. */
function boxes(bytes: Uint8Array, view: DataView, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = view.getUint32(at);
    const type = text(bytes, at + 4);
    let body = at + 8;
    if (size === 1) {
      if (at + 16 > end) return out;
      size = Number(view.getBigUint64(at + 8));
      body = at + 16;
    } else if (size === 0) size = end - at;
    if (size < body - at || at + size > end) throw new Error(`a ${type} box runs past its end`);
    out.push({ type, start: at, end: at + size, body });
    at += size;
  }
  return out;
}

const child = (bytes: Uint8Array, view: DataView, box: Box | undefined, type: string) => (box ? boxes(bytes, view, box.body, box.end).find((b) => b.type === type) : undefined);
const childrenOf = (bytes: Uint8Array, view: DataView, box: Box, type: string) => boxes(bytes, view, box.body, box.end).filter((b) => b.type === type);

type Sample = { offset: number; size: number; duration: number; sync: boolean; cto: number };
type Defaults = { duration: number; size: number; flags: number };
type Track = {
  id: number;
  trak: Box;
  timescale: number;
  defaults: Defaults;
  samples: Sample[];
  /** When the first sample is decoded, in the track's timescale. */
  start: number | null;
  /** When the samples so far end. */
  end: number;
};

/** A sample's flags say whether it's a sync sample (one a decoder can start from). */
const isSync = (flags: number) => (flags & 0x10000) === 0;

/** Reads a fragmented MP4's samples, track by track; null if it isn't one. */
function read(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const top = boxes(bytes, view, 0, bytes.length);
  const ftyp = top.find((b) => b.type === "ftyp");
  const moov = top.find((b) => b.type === "moov");
  const moofs = top.filter((b) => b.type === "moof");
  if (!ftyp || !moov || !moofs.length) return null;
  const mvhd = child(bytes, view, moov, "mvhd");
  const mvex = child(bytes, view, moov, "mvex");
  if (!mvhd || !mvex) return null;
  const movieScale = view.getUint32(mvhd.body + (bytes[mvhd.body] === 1 ? 20 : 12));
  const trex = new Map<number, Defaults>();
  for (const box of childrenOf(bytes, view, mvex, "trex")) {
    trex.set(view.getUint32(box.body + 4), { duration: view.getUint32(box.body + 12), size: view.getUint32(box.body + 16), flags: view.getUint32(box.body + 20) });
  }
  const tracks = new Map<number, Track>();
  for (const trak of childrenOf(bytes, view, moov, "trak")) {
    const tkhd = child(bytes, view, trak, "tkhd");
    const mdhd = child(bytes, view, child(bytes, view, trak, "mdia"), "mdhd");
    if (!tkhd || !mdhd) return null;
    const id = view.getUint32(tkhd.body + (bytes[tkhd.body] === 1 ? 20 : 12));
    const timescale = view.getUint32(mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
    tracks.set(id, { id, trak, timescale, defaults: trex.get(id) ?? { duration: 0, size: 0, flags: 0 }, samples: [], start: null, end: 0 });
  }
  for (const moof of moofs) {
    // Without either flag, the first traf's data starts at its moof and each next one's where the last ended.
    let carried = moof.start;
    for (const traf of childrenOf(bytes, view, moof, "traf")) {
      const tfhd = child(bytes, view, traf, "tfhd");
      if (!tfhd) return null;
      const flags = view.getUint32(tfhd.body) & 0xffffff;
      const track = tracks.get(view.getUint32(tfhd.body + 4));
      if (!track) return null;
      let at = tfhd.body + 8;
      let base = flags & 0x020000 ? moof.start : carried;
      if (flags & 0x01) {
        base = Number(view.getBigUint64(at));
        at += 8;
      }
      if (flags & 0x02) at += 4;
      const defaults = { ...track.defaults };
      if (flags & 0x08) {
        defaults.duration = view.getUint32(at);
        at += 4;
      }
      if (flags & 0x10) {
        defaults.size = view.getUint32(at);
        at += 4;
      }
      if (flags & 0x20) defaults.flags = view.getUint32(at);
      const tfdt = child(bytes, view, traf, "tfdt");
      if (tfdt) {
        const time = bytes[tfdt.body] === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);
        if (track.start === null) track.start = time;
        // A gap between fragments: the sample before it is held until the next one starts.
        else if (time > track.end && track.samples.length) track.samples[track.samples.length - 1].duration += time - track.end;
        track.end = Math.max(track.end, time);
      } else if (track.start === null) track.start = 0;
      let end = base;
      for (const trun of childrenOf(bytes, view, traf, "trun")) {
        const version = bytes[trun.body];
        const tflags = view.getUint32(trun.body) & 0xffffff;
        const count = view.getUint32(trun.body + 4);
        let p = trun.body + 8;
        let offset = end;
        if (tflags & 0x01) {
          offset = base + view.getInt32(p);
          p += 4;
        }
        let first: number | null = null;
        if (tflags & 0x04) {
          first = view.getUint32(p);
          p += 4;
        }
        for (let k = 0; k < count; k++) {
          let duration = defaults.duration;
          let size = defaults.size;
          let sampleFlags = k === 0 && first !== null ? first : defaults.flags;
          let cto = 0;
          if (tflags & 0x100) {
            duration = view.getUint32(p);
            p += 4;
          }
          if (tflags & 0x200) {
            size = view.getUint32(p);
            p += 4;
          }
          if (tflags & 0x400) {
            const read = view.getUint32(p);
            p += 4;
            if (!(k === 0 && first !== null)) sampleFlags = read;
          }
          if (tflags & 0x800) {
            cto = version === 0 ? view.getUint32(p) : view.getInt32(p);
            p += 4;
          }
          if (offset + size > bytes.length) throw new Error("a sample runs past the end of the file");
          track.samples.push({ offset, size, duration, sync: isSync(sampleFlags), cto });
          track.end += duration;
          offset += size;
        }
        end = offset;
      }
      carried = end;
    }
  }
  return { view, ftyp, mvhd, movieScale, tracks: [...tracks.values()].filter((track) => track.samples.length) };
}

/** Bytes written as they come, growing as needed. */
class Writer {
  bytes = new Uint8Array(1 << 16);
  view = new DataView(this.bytes.buffer);
  length = 0;

  private room(n: number) {
    if (this.length + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.length));
    this.bytes = next;
    this.view = new DataView(next.buffer);
  }

  u8(value: number) {
    this.room(1);
    this.bytes[this.length++] = value;
  }

  u16(value: number) {
    this.room(2);
    this.view.setUint16(this.length, value);
    this.length += 2;
  }

  u32(value: number) {
    this.room(4);
    this.view.setUint32(this.length, value >>> 0);
    this.length += 4;
  }

  i32(value: number) {
    this.room(4);
    this.view.setInt32(this.length, value);
    this.length += 4;
  }

  u64(value: number) {
    this.room(8);
    this.view.setBigUint64(this.length, BigInt(value));
    this.length += 8;
  }

  raw(bytes: Uint8Array) {
    this.room(bytes.length);
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
  }

  type(name: string) {
    for (let k = 0; k < 4; k++) this.u8(name.charCodeAt(k));
  }

  /** A box: its size is filled in once `fill` has written its insides. */
  box(name: string, fill: () => void) {
    const start = this.length;
    this.u32(0);
    this.type(name);
    fill();
    this.view.setUint32(start, this.length - start);
  }

  /** A full box: a box with a version and flags. */
  full(name: string, version: number, flags: number, fill: () => void) {
    this.box(name, () => {
      this.u32((version << 24) | flags);
      fill();
    });
  }

  done() {
    return this.bytes.slice(0, this.length);
  }
}

/** Runs of equal values, as stts and ctts keep them. */
function runs(values: number[]) {
  const out: [count: number, value: number][] = [];
  for (const value of values) {
    const last = out[out.length - 1];
    if (last && last[1] === value) last[0]++;
    else out.push([1, value]);
  }
  return out;
}

/**
 * A track's sample tables, its samples in one chunk at `offset`: how long each lasts (stts), how
 * far each is shown after it's decoded (ctts, when any is), which can start a decode (stss, unless
 * all can), the chunk (stsc), each one's size (stsz) and where the chunk starts (stco, or co64).
 */
function sampleTables(out: Writer, samples: Pick<Sample, "duration" | "size" | "sync" | "cto">[], offset: number, wide: boolean) {
  const durations = runs(samples.map((sample) => sample.duration));
  out.full("stts", 0, 0, () => {
    out.u32(durations.length);
    for (const [count, value] of durations) {
      out.u32(count);
      out.u32(value);
    }
  });
  if (samples.some((sample) => sample.cto !== 0)) {
    const offsets = runs(samples.map((sample) => sample.cto));
    const negative = offsets.some(([, value]) => value < 0);
    out.full("ctts", negative ? 1 : 0, 0, () => {
      out.u32(offsets.length);
      for (const [count, value] of offsets) {
        out.u32(count);
        if (negative) out.i32(value);
        else out.u32(value);
      }
    });
  }
  if (!samples.every((sample) => sample.sync)) {
    const syncs = samples.flatMap((sample, k) => (sample.sync ? [k + 1] : []));
    out.full("stss", 0, 0, () => {
      out.u32(syncs.length);
      for (const k of syncs) out.u32(k);
    });
  }
  out.full("stsc", 0, 0, () => {
    out.u32(1);
    out.u32(1);
    out.u32(samples.length);
    out.u32(1);
  });
  out.full("stsz", 0, 0, () => {
    out.u32(0);
    out.u32(samples.length);
    for (const sample of samples) out.u32(sample.size);
  });
  if (wide)
    out.full("co64", 0, 0, () => {
      out.u32(1);
      out.u64(offset);
    });
  else
    out.full("stco", 0, 0, () => {
      out.u32(1);
      out.u32(offset);
    });
}

/** An mdat's header for `bytes` of media: 8 bytes, or 16 when it needs a 64-bit size. */
function mdatHeader(bytes: number) {
  const large = bytes + 8 > 0xffffffff;
  const header = new Uint8Array(large ? 16 : 8);
  const view = new DataView(header.buffer);
  header.set([0x6d, 0x64, 0x61, 0x74], 4);
  if (large) {
    view.setUint32(0, 1);
    view.setBigUint64(8, BigInt(bytes + 16));
  } else view.setUint32(0, bytes + 8);
  return header;
}

/**
 * Writes a duration where a full box keeps it: `at32` bytes into its body (its version and flags
 * included) when it's version 0, as 32 bits, or `at64` when it's version 1, as 64.
 */
function patchDuration(box: Uint8Array, at32: number, at64: number, duration: number) {
  const view = new DataView(box.buffer, box.byteOffset, box.byteLength);
  const body = view.getUint32(0) === 1 ? 16 : 8;
  if (box[body] === 1) view.setBigUint64(body + at64, BigInt(duration));
  else view.setUint32(body + at32, Math.min(0xffffffff, duration));
}

/** Where each box keeps its duration, as `patchDuration` takes it. */
const MVHD: [number, number] = [16, 24];
const TKHD: [number, number] = [20, 28];
const MDHD: [number, number] = [16, 24];

/**
 * The regular MP4 for a fragmented one: ftyp, then a moov whose tracks list every sample (one
 * chunk a track) and say how long they are, then the samples as they were. With `frame`, every
 * sample lasts that many seconds, from the start. Null when the bytes aren't a fragmented MP4
 * this understands.
 */
export function defragment(input: Uint8Array, { frame }: { frame?: number } = {}): Uint8Array | null {
  let parsed: ReturnType<typeof read>;
  try {
    parsed = read(input);
  } catch {
    return null;
  }
  if (!parsed || !parsed.tracks.length) return null;
  // Every sample `frame` seconds long, from the start: a take made a frame at a time (Render) was
  // recorded at whatever pace each frame took to make, and plays at its own.
  if (frame) {
    for (const track of parsed.tracks) {
      const duration = Math.max(1, Math.round(track.timescale * frame));
      for (const sample of track.samples) sample.duration = duration;
      track.start = 0;
    }
  }
  const { view, ftyp, mvhd, movieScale, tracks } = parsed;
  const copy = (box: Box) => input.slice(box.start, box.end);
  const bytesOf = (track: Track) => track.samples.reduce((total, sample) => total + sample.size, 0);
  const mediaBytes = tracks.reduce((total, track) => total + bytesOf(track), 0);
  // Every track's length on the movie's clock, a late start included: late after the track that starts first.
  const lengthOf = (track: Track) => track.samples.reduce((total, sample) => total + sample.duration, 0);
  const movieTime = (track: Track, time: number) => Math.round((time * movieScale) / track.timescale);
  const origin = Math.min(...tracks.map((track) => (track.start ?? 0) / track.timescale));
  const startOf = (track: Track) => Math.max(0, Math.round(((track.start ?? 0) / track.timescale - origin) * track.timescale));
  const movieLength = Math.max(...tracks.map((track) => movieTime(track, startOf(track) + lengthOf(track))));

  const moovOf = (chunkOffsets: number[], wide: boolean) => {
    const out = new Writer();
    out.box("moov", () => {
      const header = copy(mvhd);
      patchDuration(header, ...MVHD, movieLength);
      out.raw(header);
      tracks.forEach((track, index) => {
        const tkhd = child(input, view, track.trak, "tkhd")!;
        const mdia = child(input, view, track.trak, "mdia")!;
        const minf = child(input, view, mdia, "minf")!;
        const stbl = child(input, view, minf, "stbl")!;
        const edts = child(input, view, track.trak, "edts");
        out.box("trak", () => {
          const tkhdBytes = copy(tkhd);
          patchDuration(tkhdBytes, ...TKHD, movieTime(track, startOf(track) + lengthOf(track)));
          out.raw(tkhdBytes);
          if (edts && !frame) out.raw(copy(edts));
          else if (startOf(track) > 0) {
            // Starts late: an empty edit until it does, then the whole track.
            out.box("edts", () =>
              out.full("elst", 0, 0, () => {
                out.u32(2);
                out.u32(movieTime(track, startOf(track)));
                out.i32(-1);
                out.u32(0x00010000);
                out.u32(movieTime(track, lengthOf(track)));
                out.i32(0);
                out.u32(0x00010000);
              }),
            );
          }
          out.box("mdia", () => {
            for (const box of boxes(input, view, mdia.body, mdia.end)) {
              if (box.type === "mdhd") {
                const mdhd = copy(box);
                patchDuration(mdhd, ...MDHD, lengthOf(track));
                out.raw(mdhd);
              } else if (box.type !== "minf") out.raw(copy(box));
            }
            out.box("minf", () => {
              for (const box of boxes(input, view, minf.body, minf.end)) if (box.type !== "stbl") out.raw(copy(box));
              out.box("stbl", () => {
                const stsd = child(input, view, stbl, "stsd");
                if (stsd) out.raw(copy(stsd));
                sampleTables(out, track.samples, chunkOffsets[index], wide);
              });
            });
          });
        });
      });
    });
    return out.done();
  };

  const ftypBytes = copy(ftyp);
  const wide = ftypBytes.length + mediaBytes + 1e6 > 0xffffffff;
  // Measured once with stand-in offsets, then written with the real ones (the same size).
  const moovSize = moovOf(tracks.map(() => 0), wide).length;
  const mdat = mdatHeader(mediaBytes);
  const offsets: number[] = [];
  let at = ftypBytes.length + moovSize + mdat.length;
  for (const track of tracks) {
    offsets.push(at);
    at += bytesOf(track);
  }
  const moov = moovOf(offsets, wide);
  const output = new Uint8Array(ftypBytes.length + moov.length + mdat.length + mediaBytes);
  output.set(ftypBytes, 0);
  output.set(moov, ftypBytes.length);
  let p = ftypBytes.length + moov.length;
  output.set(mdat, p);
  p += mdat.length;
  for (const track of tracks) for (const sample of track.samples) output.set(input.subarray(sample.offset, sample.offset + sample.size), (p += sample.size) - sample.size);
  return output;
}

/** Whether these bytes look like a fragmented MP4: a moov with mvex, fragments after it. */
export function isFragmented(input: Uint8Array) {
  try {
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const top = boxes(input, view, 0, input.length);
    const moov = top.find((b) => b.type === "moov");
    return !!moov && !!child(input, view, moov, "mvex") && top.some((b) => b.type === "moof");
  } catch {
    return false;
  }
}

/** Ticks a second on a made video's clock: a whole number of them a frame at 24, 25, 30, 50 or 60 a second. */
const TIMESCALE = 90_000;

/**
 * A video's frames as an encoder hands them over (WebCodecs' `VideoEncoder`): H.264 with each NAL
 * unit after its length (its `avc` format), and what a decoder needs to read them.
 */
export type EncodedVideo = {
  width: number;
  height: number;
  /** The decoder's configuration, an avcC record: the encoder's `decoderConfig.description`. */
  avcC: Uint8Array;
  /** Frames a second: each frame lasts one of them. */
  fps: number;
  /** In the order they're decoded: each one's size in bytes, whether a decode can start there, and which frame of the video it shows, from 0. */
  frames: { size: number; key: boolean; at: number }[];
};

/**
 * Everything a regular MP4 of these encoded frames holds before them, laid out as `defragment`
 * lays one out: ftyp, a moov listing every frame (one chunk, each frame `1 / fps` long, the key
 * frames named, and when each is shown if that isn't the order they're decoded in), and the mdat's
 * header. The frames' bytes follow it, in the order they came: the header and they are the file,
 * so a long take's frames can stay where they are (in Blobs) while it's put together. Pure.
 */
export function mp4Header({ width, height, avcC, fps, frames }: EncodedVideo): Uint8Array<ArrayBuffer> {
  if (!frames.length || !frames[0].key) throw new Error("a video starts with a key frame");
  const tick = Math.round(TIMESCALE / fps);
  const samples = frames.map((frame, k) => ({ size: frame.size, duration: tick, sync: frame.key, cto: (frame.at - k) * tick }));
  const length = frames.length * tick;
  const mediaBytes = samples.reduce((total, sample) => total + sample.size, 0);
  const wide = mediaBytes + 1e6 > 0xffffffff;
  const matrix = (out: Writer) => [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].forEach((value) => out.u32(value));

  const ftyp = new Writer();
  ftyp.box("ftyp", () => {
    ftyp.type("isom");
    ftyp.u32(0x200);
    for (const brand of ["isom", "iso2", "avc1", "mp41"]) ftyp.type(brand);
  });
  const ftypBytes = ftyp.done();

  const moovOf = (offset: number) => {
    const out = new Writer();
    out.box("moov", () => {
      out.full("mvhd", 0, 0, () => {
        out.u32(0);
        out.u32(0);
        out.u32(TIMESCALE);
        out.u32(length);
        out.u32(0x00010000);
        out.u16(0x0100);
        out.u16(0);
        out.u32(0);
        out.u32(0);
        matrix(out);
        for (let k = 0; k < 6; k++) out.u32(0);
        out.u32(2);
      });
      out.box("trak", () => {
        // Enabled and in the movie.
        out.full("tkhd", 0, 3, () => {
          out.u32(0);
          out.u32(0);
          out.u32(1);
          out.u32(0);
          out.u32(length);
          out.u32(0);
          out.u32(0);
          out.u16(0);
          out.u16(0);
          out.u16(0);
          out.u16(0);
          matrix(out);
          out.u32(width * 0x10000);
          out.u32(height * 0x10000);
        });
        out.box("mdia", () => {
          out.full("mdhd", 0, 0, () => {
            out.u32(0);
            out.u32(0);
            out.u32(TIMESCALE);
            out.u32(length);
            // "und": no language.
            out.u16(0x55c4);
            out.u16(0);
          });
          out.full("hdlr", 0, 0, () => {
            out.u32(0);
            out.type("vide");
            out.u32(0);
            out.u32(0);
            out.u32(0);
            for (const c of "VideoHandler\0") out.u8(c.charCodeAt(0));
          });
          out.box("minf", () => {
            out.full("vmhd", 0, 1, () => {
              for (let k = 0; k < 4; k++) out.u16(0);
            });
            out.box("dinf", () =>
              out.full("dref", 0, 0, () => {
                out.u32(1);
                // The frames are in this file.
                out.full("url ", 0, 1, () => {});
              }),
            );
            out.box("stbl", () => {
              out.full("stsd", 0, 0, () => {
                out.u32(1);
                out.box("avc1", () => {
                  for (let k = 0; k < 6; k++) out.u8(0);
                  out.u16(1);
                  out.u16(0);
                  out.u16(0);
                  for (let k = 0; k < 3; k++) out.u32(0);
                  out.u16(width);
                  out.u16(height);
                  // 72 dots an inch, across and down.
                  out.u32(0x00480000);
                  out.u32(0x00480000);
                  out.u32(0);
                  out.u16(1);
                  // No compressor's name: 32 bytes, the first its length.
                  for (let k = 0; k < 32; k++) out.u8(0);
                  out.u16(0x0018);
                  out.u16(0xffff);
                  out.box("avcC", () => out.raw(avcC));
                });
              });
              sampleTables(out, samples, offset, wide);
            });
          });
        });
      });
    });
    return out.done();
  };

  // Measured once with a stand-in offset, then written with the real one (the same size).
  const mdat = mdatHeader(mediaBytes);
  const moov = moovOf(ftypBytes.length + moovOf(0).length + mdat.length);
  const output = new Uint8Array(ftypBytes.length + moov.length + mdat.length);
  output.set(ftypBytes, 0);
  output.set(moov, ftypBytes.length);
  output.set(mdat, ftypBytes.length + moov.length);
  return output;
}

/** A track as a player finds it: its clock, and every sample (where it is, how big, how long, whether a decode can start there, when it's shown). */
export type TrackSamples = { id: number; timescale: number; samples: Sample[] };

/** A regular MP4's tracks, read from their sample tables (the moov's stbl: no fragments). */
function readRegular(bytes: Uint8Array, view: DataView, moov: Box): TrackSamples[] | null {
  const tracks: TrackSamples[] = [];
  for (const trak of childrenOf(bytes, view, moov, "trak")) {
    const tkhd = child(bytes, view, trak, "tkhd");
    const mdia = child(bytes, view, trak, "mdia");
    const mdhd = child(bytes, view, mdia, "mdhd");
    const stbl = child(bytes, view, child(bytes, view, mdia, "minf"), "stbl");
    if (!tkhd || !mdhd || !stbl) return null;
    const id = view.getUint32(tkhd.body + (bytes[tkhd.body] === 1 ? 20 : 12));
    const timescale = view.getUint32(mdhd.body + (bytes[mdhd.body] === 1 ? 20 : 12));
    const table = (type: string) => child(bytes, view, stbl, type);
    const stts = table("stts");
    const stsz = table("stsz");
    const stsc = table("stsc");
    const stco = table("stco") ?? table("co64");
    if (!stts || !stsz || !stsc || !stco) return null;
    const count = view.getUint32(stsz.body + 8);
    const fixed = view.getUint32(stsz.body + 4);
    const sizes = Array.from({ length: count }, (_, k) => (fixed ? fixed : view.getUint32(stsz.body + 12 + 4 * k)));
    const expand = (box: Box | undefined, signed: boolean) => {
      const values: number[] = [];
      if (!box) return values;
      const negative = signed && bytes[box.body] === 1;
      for (let k = 0, entries = view.getUint32(box.body + 4); k < entries; k++) {
        const value = negative ? view.getInt32(box.body + 12 + 8 * k) : view.getUint32(box.body + 12 + 8 * k);
        for (let n = view.getUint32(box.body + 8 + 8 * k); n > 0; n--) values.push(value);
      }
      return values;
    };
    const durations = expand(stts, false);
    const ctos = expand(table("ctts"), true);
    const stss = table("stss");
    const syncs = stss ? new Set(Array.from({ length: view.getUint32(stss.body + 4) }, (_, k) => view.getUint32(stss.body + 8 + 4 * k))) : null;
    const wide = stco.type === "co64";
    const chunks = Array.from({ length: view.getUint32(stco.body + 4) }, (_, k) => (wide ? Number(view.getBigUint64(stco.body + 8 + 8 * k)) : view.getUint32(stco.body + 8 + 4 * k)));
    const runsOf = Array.from({ length: view.getUint32(stsc.body + 4) }, (_, k) => ({ first: view.getUint32(stsc.body + 8 + 12 * k), each: view.getUint32(stsc.body + 12 + 12 * k) }));
    if (durations.length !== count) return null;
    const samples: Sample[] = [];
    for (const [c, start] of chunks.entries()) {
      // How many samples this chunk holds: as the last run that starts at or before it says.
      const each = runsOf.filter((run) => run.first <= c + 1).at(-1)?.each ?? 0;
      let at = start;
      for (let n = 0; n < each && samples.length < count; n++) {
        const k = samples.length;
        if (at + sizes[k] > bytes.length) return null;
        samples.push({ offset: at, size: sizes[k], duration: durations[k], sync: syncs ? syncs.has(k + 1) : true, cto: ctos[k] ?? 0 });
        at += sizes[k];
      }
    }
    if (samples.length !== count) return null;
    tracks.push({ id, timescale, samples });
  }
  return tracks;
}

/**
 * Every track's samples, as a player would find them in an MP4, fragmented (as a recorder writes
 * one) or regular (as `defragment` and `mp4Of` write one). Null for what this can't read.
 */
export function samplesOf(input: Uint8Array): TrackSamples[] | null {
  try {
    if (isFragmented(input)) return read(input)?.tracks.map(({ id, timescale, samples }) => ({ id, timescale, samples })) ?? null;
    const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
    const moov = boxes(input, view, 0, input.length).find((b) => b.type === "moov");
    return moov ? readRegular(input, view, moov) : null;
  } catch {
    return null;
  }
}
