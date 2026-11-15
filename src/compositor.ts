/**
 * Draws each captured frame onto a canvas, alone or set on a background (a colour, a gradient
 * or a picture) with room round it, rounded corners and a soft shadow, and gives the canvas
 * back as a video track, one canvas frame per captured frame. Sizes are the capture's own
 * pixels, so nothing is enlarged.
 */

import { insetRect } from "./frame.ts";

// The page's own timers: while a take is rendered, Closeup holds the page's clock (`clock.ts`).
const realTimeout = setTimeout.bind(globalThis);
const realClear = clearTimeout.bind(globalThis);

export type Background =
  | { kind: "none" }
  | { kind: "color"; color: string }
  | { kind: "gradient"; from: string; to: string; angle: number }
  | { kind: "image"; image: ImageBitmap };

export type Look = {
  background: Background;
  /** Room between the take's edge and the page, a share of its shorter side (with a background only). */
  inset: number;
  /** Corner radius of the page on its background, in pixels at 1080p (with a background only). */
  radius: number;
  shadow: boolean;
};

type CanvasTrack = MediaStreamTrack & { requestFrame(): void };

export class Compositor {
  readonly canvas = document.createElement("canvas");
  private readonly context = this.canvas.getContext("2d", { alpha: false })!;
  private readonly video = document.createElement("video");
  private output: CanvasTrack | null = null;
  private callback = 0;
  private stopped = false;

  constructor(
    private readonly input: MediaStreamTrack,
    private readonly look: Look,
    /** Where the hidden video playing the capture lives: outside the page's <body>. */
    private readonly host: Element,
  ) {}

  /**
   * Starts once the first frame arrives (it sets the size) and resolves with the composed track.
   * A tab sends a frame only when something in it repaints, and a capture cropped as it starts
   * can stay silent, so until the first frame `nudge` is called every animation frame (it should
   * repaint something in the frame, unseen) and `wake` every half second (it should crop again).
   */
  async start({ nudge, wake }: Waking): Promise<MediaStreamTrack> {
    const video = this.video;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([this.input]);
    // Laid out but unseen, so the browser keeps decoding it.
    Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
    this.host.append(video);
    const playing = video.play();
    await firstFrame(video, nudge, wake);
    await playing;
    this.canvas.width = video.videoWidth;
    this.canvas.height = video.videoHeight;
    this.output = this.canvas.captureStream(0).getVideoTracks()[0] as CanvasTrack;
    this.draw();
    const loop = (now: number, frame: { captureTime?: number }) => {
      if (this.stopped) return;
      this.draw();
      this.output?.requestFrame();
      // When the tab drew it (else when it got here), for what waits for a picture taken after a moment.
      this.latest = frame.captureTime ?? now;
      for (const waiting of [...this.waiting]) if (this.latest >= waiting.after) waiting.done(true);
      this.callback = video.requestVideoFrameCallback(loop);
    };
    this.callback = video.requestVideoFrameCallback(loop);
    return this.output;
  }

  get size() {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  private latest = 0;
  private readonly waiting = new Set<{ after: number; done: (fresh: boolean) => void }>();

  /**
   * Resolves once the canvas holds a picture the tab took after `after` (on the page's own clock,
   * `realNow`): true then, false if none came in `within` ms (nothing on the page changed).
   */
  frameAfter(after: number, within: number): Promise<boolean> {
    if (this.latest >= after) return Promise.resolve(true);
    return new Promise((resolve) => {
      const waiting = {
        after,
        done: (fresh: boolean) => {
          this.waiting.delete(waiting);
          realClear(timer);
          resolve(fresh);
        },
      };
      const timer = realTimeout(() => waiting.done(false), within);
      this.waiting.add(waiting);
    });
  }

  /** The composed frame now, as a PNG. */
  snapshot(): Promise<Blob> {
    this.draw();
    return new Promise((resolve, reject) => this.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No frame"))), "image/png"));
  }

  stop() {
    this.stopped = true;
    this.video.cancelVideoFrameCallback?.(this.callback);
    this.output?.stop();
    this.video.srcObject = null;
    this.video.remove();
  }

  private draw() {
    const { context, canvas, video } = this;
    if (!canvas.width || video.readyState < 2) return;
    paintTake(context, video, canvas.width, canvas.height, this.look);
  }
}

/**
 * One frame of a take as it's kept: `source` (a frame of the capture) alone, or set on the look's
 * background with room round it, rounded corners and a soft shadow, on a canvas `width` by
 * `height` (the capture's own size). The recorder draws every frame with it, and so does anything
 * that makes a take's frames some other way.
 */
export function paintTake(c: CanvasRenderingContext2D, source: CanvasImageSource, width: number, height: number, look: Look) {
  if (look.background.kind === "none") {
    c.drawImage(source, 0, 0, width, height);
    return;
  }
  paintBackground(c, look.background, width, height);
  const inner = insetRect({ width, height }, look.inset);
  const unit = Math.min(width, height) / 1080;
  const radius = look.radius * unit;
  if (look.shadow) {
    c.save();
    c.shadowColor = "rgb(0 0 0 / 0.28)";
    c.shadowBlur = 48 * unit;
    c.shadowOffsetY = 16 * unit;
    c.fillStyle = "#000";
    c.beginPath();
    c.roundRect(inner.x, inner.y, inner.width, inner.height, radius);
    c.fill();
    c.restore();
  }
  c.save();
  c.beginPath();
  c.roundRect(inner.x, inner.y, inner.width, inner.height, radius);
  c.clip();
  c.drawImage(source, inner.x, inner.y, inner.width, inner.height);
  c.restore();
}

function paintBackground(c: CanvasRenderingContext2D, background: Background, width: number, height: number) {
  if (background.kind === "color") {
    c.fillStyle = background.color;
    c.fillRect(0, 0, width, height);
  } else if (background.kind === "gradient") {
    const angle = (background.angle * Math.PI) / 180;
    const half = (Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))) / 2;
    const [dx, dy] = [Math.sin(angle) * half, -Math.cos(angle) * half];
    const gradient = c.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    c.fillStyle = gradient;
    c.fillRect(0, 0, width, height);
  } else if (background.kind === "image") {
    // Cover: the picture fills the take, cropped evenly on the long side.
    const { image } = background;
    const scale = Math.max(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    c.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
  }
}

/** How long a capture may take to send its first picture before the take gives up, and how often it's woken meanwhile. */
const FIRST_FRAME_MS = 5000;
const WAKE_MS = 500;

export type Waking = { nudge: () => void; wake: () => Promise<unknown> };

function firstFrame(video: HTMLVideoElement, nudge: () => void, wake: () => Promise<unknown>) {
  return new Promise<void>((resolve, reject) => {
    let done = false;
    let frame = 0;
    const started = performance.now();
    const end = () => {
      done = true;
      cancelAnimationFrame(frame);
    };
    video.requestVideoFrameCallback(() => {
      end();
      resolve();
    });
    const tick = () => {
      if (done) return;
      nudge();
      frame = requestAnimationFrame(tick);
    };
    tick();
    void (async () => {
      while (!done) {
        await new Promise((next) => setTimeout(next, WAKE_MS));
        if (done) return;
        if (performance.now() - started > FIRST_FRAME_MS) {
          end();
          reject(new Error("the tab sent no picture"));
          return;
        }
        await wake().catch(() => undefined);
      }
    })();
  });
}
