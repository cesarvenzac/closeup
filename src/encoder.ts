/**
 * A rendered take's frames encoded as they're made, every one kept (WebCodecs' `VideoEncoder`, in
 * H.264), then made a regular MP4 (`mp4Header`). A recorder takes frames at whatever pace they come
 * and leaves out those its encoder can't keep up with, saying nothing: a software encoder at a
 * large size kept about half the frames it was handed as fast as a canvas draws them. Here the
 * next frame waits until the encoder has room for it, so none is ever left out, however slowly
 * the machine encodes; and each is stamped with its own moment, so it lasts exactly a frame.
 */

import { mp4Header } from "./mp4.ts";

// The page's own timers: while a take is rendered, Closeup holds the page's clock (`clock.ts`).
const realTimeout = setTimeout.bind(globalThis);
const realClear = clearTimeout.bind(globalThis);

/**
 * H.264's levels (ITU-T H.264, table A-1): the level times ten, then the most macroblocks a
 * second and a frame, and the most thousands of bits a second for the Baseline and Main profiles
 * (High allows a quarter more).
 */
const LEVELS: [level: number, perSecond: number, perFrame: number, kilobits: number][] = [
  [30, 40_500, 1_620, 10_000],
  [31, 108_000, 3_600, 14_000],
  [32, 216_000, 5_120, 20_000],
  [40, 245_760, 8_192, 20_000],
  [41, 245_760, 8_192, 50_000],
  [42, 522_240, 8_704, 50_000],
  [50, 589_824, 22_080, 135_000],
  [51, 983_040, 36_864, 240_000],
  [52, 2_073_600, 36_864, 240_000],
  [60, 4_177_920, 139_264, 240_000],
  [61, 8_355_840, 139_264, 480_000],
  [62, 16_711_680, 139_264, 800_000],
];

/**
 * The codec H.264 encodes a take in: the High profile at the lowest level that holds frames this
 * size (even, as `evenSize` makes them), this many a second, at this many bits a second. A level
 * too low for the frame is refused; one far too high can be refused by a player that's never met
 * it. Null past the highest.
 */
export function avcCodec(width: number, height: number, fps: number, bitrate: number): string | null {
  const blocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  // A frame's side may be at most √(8 × the macroblocks a frame), in macroblocks.
  const side = Math.max(Math.ceil(width / 16), Math.ceil(height / 16));
  const fits = LEVELS.find(([, perSecond, perFrame, kilobits]) => blocks <= perFrame && side * side <= 8 * perFrame && blocks * fps <= perSecond && bitrate <= kilobits * 1250);
  return fits ? `avc1.6400${fits[0].toString(16).padStart(2, "0")}` : null;
}

/** The size H.264 encodes a frame at: even both ways, as its colour (a sample a square of four) needs; an odd one loses its last column or row. */
export const evenSize = ({ width, height }: { width: number; height: number }) => ({ width: width - (width % 2), height: height - (height % 2) });

/** How many frames may wait for the encoder before the next one is held back. */
export const QUEUE_MOST = 2;

/** Seconds between key frames, where a player can start: seeking in a take never decodes more than this. */
export const KEY_EVERY = 2;

/** How much of a take is gathered in memory before it's put in a Blob (which the browser may keep on disk). */
const PART_BYTES = 4 << 20;

export type EncoderOptions = { width: number; height: number; fps: number; bitrate: number };

/**
 * Encodes a canvas's pictures, one a frame, into an MP4 nothing is left out of. `open` says
 * whether this browser can (null when it can't, at this size, so the take is recorded instead);
 * `add` hands over the canvas as it is now and resolves once the encoder has room for the next;
 * `finish` waits for the last and gives the take.
 */
export class FrameEncoder {
  private readonly encoder: VideoEncoder;
  private readonly frames: { size: number; key: boolean; at: number }[] = [];
  private readonly parts: Blob[] = [];
  private pending: Uint8Array<ArrayBuffer>[] = [];
  private pendingBytes = 0;
  private avcC: Uint8Array | null = null;
  private error: Error | null = null;
  private added = 0;

  private constructor(
    private readonly config: VideoEncoderConfig,
    private readonly options: EncoderOptions,
  ) {
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => this.keep(chunk, metadata),
      error: (error) => {
        this.error ??= error instanceof Error ? error : new Error(String(error));
      },
    });
    this.encoder.configure(config);
  }

  /** An encoder for frames of this size (made even), or null where this browser can't encode them. */
  static async open(options: EncoderOptions): Promise<FrameEncoder | null> {
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
    const size = evenSize(options);
    const codec = avcCodec(size.width, size.height, options.fps, options.bitrate);
    if (!codec || size.width < 2 || size.height < 2) return null;
    const config: VideoEncoderConfig = { codec, ...size, bitrate: options.bitrate, framerate: options.fps, avc: { format: "avc" }, latencyMode: "quality" };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(config);
      return supported ? new FrameEncoder(config, { ...options, ...size }) : null;
    } catch {
      return null;
    }
  }

  /** Frames handed over so far. */
  get count() {
    return this.added;
  }

  /** The size the take is encoded at. */
  get size() {
    return { width: this.options.width, height: this.options.height };
  }

  /**
   * Hands over `source` as it is now, as the next frame (a key frame every `KEY_EVERY` seconds),
   * then waits for the encoder to have room. Throws if the encoder failed.
   */
  async add(source: CanvasImageSource) {
    if (this.error) throw this.error;
    const { fps, width, height } = this.options;
    const k = this.added;
    // Whole microseconds, each from its own place: a frame's length never drifts.
    const frame = new VideoFrame(source, {
      timestamp: Math.round((k * 1e6) / fps),
      duration: Math.round(((k + 1) * 1e6) / fps) - Math.round((k * 1e6) / fps),
      visibleRect: { x: 0, y: 0, width, height },
      alpha: "discard",
    });
    try {
      this.encoder.encode(frame, { keyFrame: k % Math.round(KEY_EVERY * fps) === 0 });
    } finally {
      frame.close();
    }
    this.added++;
    await this.room();
    if (this.error) throw this.error;
  }

  /** Waits for every frame to be encoded and gives the take as an MP4. */
  async finish(): Promise<Blob> {
    if (this.error) throw this.error;
    await this.encoder.flush();
    if (this.error) throw this.error;
    this.encoder.close();
    if (!this.avcC || this.frames.length !== this.added) throw new Error(`the encoder gave back ${this.frames.length} of ${this.added} frames`);
    this.store();
    const header = mp4Header({ ...this.size, avcC: this.avcC, fps: this.options.fps, frames: this.frames });
    return new Blob([header, ...this.parts], { type: "video/mp4" });
  }

  /** Lets go of the encoder (and whatever it made) without making a take. */
  close() {
    if (this.encoder.state !== "closed") this.encoder.close();
  }

  private keep(chunk: EncodedVideoChunk, metadata?: EncodedVideoChunkMetadata) {
    const description = metadata?.decoderConfig?.description;
    if (description && !this.avcC) {
      this.avcC = ArrayBuffer.isView(description) ? new Uint8Array(description.buffer.slice(description.byteOffset, description.byteOffset + description.byteLength)) : new Uint8Array(description.slice(0));
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    this.frames.push({ size: data.length, key: chunk.type === "key", at: Math.round((chunk.timestamp * this.options.fps) / 1e6) });
    this.pending.push(data);
    this.pendingBytes += data.length;
    if (this.pendingBytes >= PART_BYTES) this.store();
  }

  /** What's gathered in memory, put in a Blob. */
  private store() {
    if (!this.pending.length) return;
    this.parts.push(new Blob(this.pending));
    this.pending = [];
    this.pendingBytes = 0;
  }

  /** Resolves once no more than `QUEUE_MOST` frames wait for the encoder (or it failed). */
  private room() {
    const free = () => this.encoder.encodeQueueSize <= QUEUE_MOST || !!this.error || this.encoder.state === "closed";
    if (free()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof realTimeout> | undefined;
      const check = () => {
        realClear(timer);
        if (free()) {
          this.encoder.removeEventListener("dequeue", check);
          resolve();
          // Looked at again now and then too, should the encoder not say when its queue moves.
        } else timer = realTimeout(check, 50);
      };
      this.encoder.addEventListener("dequeue", check);
      check();
    });
  }
}
