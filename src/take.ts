/**
 * A take, start to end: share this tab, put the picked area on stage, crop the capture to it,
 * draw the cursor (following your mouse, or played from a script), compose the frames on their
 * background, and record them (with the clicks and the tab's sound) or keep one as a photo.
 * While a video is filmed the camera may close in on each click and pans down the page when
 * the wheel turns where nothing else scrolls. Everything is put back afterwards, in order.
 */

import { Camera } from "./camera.ts";
import { cropTo, recrop, shareTab } from "./capture.ts";
import { painted, realNow, settle, takeTime } from "./clock.ts";
import { type Background, Compositor, type Look } from "./compositor.ts";
import { DrawnCursor } from "./cursor.ts";
import { FrameEncoder } from "./encoder.ts";
import { fillFor, frameAround, type Rect, SHAPES, type Stage, stageFor } from "./frame.ts";
import { emulateHover } from "./hover.ts";
import type { Point } from "./path.ts";
import { play } from "./player.ts";
import { SyntheticPointer } from "./pointer.ts";
import { type Script, TAIL } from "./script.ts";
import { GRADIENTS, type Settings } from "./settings.ts";
import { Mixer } from "./sounds.ts";
import { regular } from "./export.ts";
import { enterStage, holdStill, nextFrame, wait } from "./stage.ts";
import { scrollerFor, wheelPixels } from "./wheel.ts";

export type Picked = { element: Element | null; rect: Rect };

export type Result = {
  kind: "photo" | "video";
  blob: Blob;
  type: string;
  width: number;
  height: number;
  seconds?: number;
  /** The script a video's cursor played, so the take can be filmed again. */
  script?: Script;
};

export type Running = {
  /** The staged frame on screen, for placing the controls round it. */
  screen: Rect;
  /** Seconds recorded so far, pauses left out. */
  elapsed(): number;
  readonly paused: boolean;
  /** Holds the recording, and goes on with it (a take by hand: a script plays on its own). */
  pause(): void;
  resume(): void;
  /** For a scripted take: settles once the script has played and the cursor has lingered. */
  finished?: Promise<void>;
  /** Made a frame at a time (Render) rather than recorded as it plays. */
  rendering?: boolean;
  stop(): Promise<Result>;
};

/**
 * What happens between the stage being set and the take starting: a countdown, most often.
 * Given the frame on screen; a rejection calls the take off.
 */
export type Before = (screen: Rect) => Promise<void>;

export const toRect = ({ x, y, width, height }: DOMRectReadOnly): Rect => ({ x, y, width, height });

/** What a take films: an element with room round it, a drawn region as drawn, either one to the chosen shape. */
export const frameOf = (rect: Rect, element: Element | null, settings: Settings) =>
  frameAround(rect, element ? settings.padding : 0, SHAPES[settings.shape]);

/** How a take is set: on nothing, or on its background (a picture needs `image`), with its room, corners and shadow. */
export function lookOf(settings: Settings, image: ImageBitmap | null): Look {
  let background: Background = { kind: "none" };
  if (settings.background === "color") background = { kind: "color", color: settings.color };
  if (settings.background === "gradient") background = { kind: "gradient", ...GRADIENTS[settings.gradient] };
  if (settings.background === "image" && image) background = { kind: "image", image };
  return { background, inset: settings.inset, radius: settings.radius, shadow: settings.shadow };
}

/** The box the capture is cropped to, and a dim veil round it that shows what's filmed (outside the box, so never in it). */
export function frameBox(screen: Rect, host: Element) {
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    left: `${screen.x}px`,
    top: `${screen.y}px`,
    width: `${screen.width}px`,
    height: `${screen.height}px`,
    pointerEvents: "none",
    zIndex: "2147483640",
    boxShadow: "0 0 0 100vmax rgb(12 12 14 / 0.42)",
    borderRadius: "2px",
  });
  host.append(box);
  return box;
}

type Undo = () => unknown;

/** Where a take's own layers go (the crop box, the cursor, the hidden video), and which events are Closeup's own. */
export type Layers = { host: HTMLElement; ignore: (target: EventTarget | null) => boolean };

/** The page's element at a point, Closeup's own layers left out. */
export const pageHit =
  ({ host, ignore }: Layers) =>
  (x: number, y: number) =>
    document.elementsFromPoint(x, y).find((element) => !(ignore(element) || host.contains(element))) ?? null;

/** What plays a script: the drawn cursor, the pointer the page is told about, and how it finds what's under a point. */
export type Actor = { cursor: DrawnCursor; pointer: SyntheticPointer; hit: (x: number, y: number) => Element | null; dispose(): void };

/**
 * What plays a script, set up over the page: a clear sheet that keeps the real mouse off it (so
 * nothing under it hovers) with the real cursor hidden, the page's hover rules copied for the
 * drawn cursor, the pointer the page is told about, and the cursor. `dispose()` takes it all away,
 * telling the page the pointer left so what it hovers lets go.
 */
export function createActor(layers: Layers, { size, onPress, ring, hidden }: { size: number; onPress?: (down: boolean) => void; ring?: boolean; hidden?: boolean }): Actor {
  const shield = document.createElement("div");
  Object.assign(shield.style, { position: "fixed", inset: "0", zIndex: "2147483641", pointerEvents: "auto" });
  layers.host.append(shield);
  const hover = emulateHover();
  const hit = pageHit(layers);
  const pointer = new SyntheticPointer(hit);
  const cursor = new DrawnCursor(layers.host, {
    size,
    onPress,
    ring,
    hidden,
    hit,
    // Looked for through the sheet, which would otherwise be all there is at any point.
    caretAt: (x, y) => {
      shield.style.pointerEvents = "none";
      try {
        return document.caretRangeFromPoint(x, y);
      } finally {
        shield.style.pointerEvents = "auto";
      }
    },
  });
  cursor.show();
  return {
    cursor,
    pointer,
    hit,
    dispose() {
      pointer.leave();
      cursor.destroy();
      hover.remove();
      shield.remove();
    },
  };
}

/** How tall the page is, as laid out: measured before it's staged, since an enlarged <body> overflows further. */
export const pageHeight = () => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);

/** A camera over a stage that's just been set: on animation frames, still under reduced motion. */
export const cameraFor = (stage: Stage, scroll: Point, height: number) =>
  new Camera({ stage, scroll, pageHeight: height, still: matchMedia("(prefers-reduced-motion: reduce)").matches });

/** `drawn`: whether a script's cursor is drawn (the panel always draws it; `film` may not). */
async function setUp(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, mixer: Mixer | null, script: Script | null, drawn = true) {
  const { host, ignore } = layers;
  const undo: Undo[] = [];
  const hit = pageHit(layers);
  const onPress = mixer && settings.clicks ? (down: boolean) => mixer.click(down) : undefined;
  let actor: Actor | null = null;
  let cursor: DrawnCursor | null = null;
  const unwind = async () => {
    for (const step of undo.reverse()) await step();
  };
  try {
    const { stream, video, audio } = await shareTab({ audio: settings.mode === "video" && settings.tabAudio });
    undo.push(() => stream.getTracks().forEach((track) => track.stop()));
    // Measured now, laid out as the stage will lay it out: the page may have moved since the pick,
    // and on stage a part fixed to the window is placed against <body> instead.
    undo.push(holdStill());
    const rect = picked.element?.isConnected ? toRect(picked.element.getBoundingClientRect()) : picked.rect;
    const frame = frameOf(rect, picked.element, settings);
    const viewport = { width: innerWidth, height: innerHeight };
    const scroll = { x: scrollX, y: scrollY };
    const stage = stageFor(frame, viewport, fillFor(viewport), scroll);
    const height = pageHeight();
    const leave = await enterStage(stage);
    undo.push(leave);
    const camera = cameraFor(stage, scroll, height);
    // Stopped before the stage is put back, which takes the page from wherever it is.
    undo.push(() => camera.stop());
    const box = frameBox(stage.screen, host);
    undo.push(() => box.remove());
    await cropTo(video, box);
    if (script) {
      actor = createActor(layers, { size: settings.cursorSize, onPress, ring: settings.ring, hidden: !drawn });
      undo.push(() => actor?.dispose());
    } else if (settings.cursor) {
      const drawn = new DrawnCursor(host, { size: settings.cursorSize, onPress, ring: settings.ring, ignore, hit });
      drawn.follow();
      cursor = drawn;
      undo.push(() => drawn.destroy());
    }
    const compositor = new Compositor(video, lookOf(settings, image), host);
    // Until the first picture: a single pixel in the frame's corner (where the rounded corners
    // clip it) flickering between 1% and 2% white, so the tab has something to send.
    const pixel = document.createElement("div");
    Object.assign(pixel.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px" });
    box.append(pixel);
    let lit = false;
    const composed = await compositor
      .start({
        nudge: () => {
          lit = !lit;
          pixel.style.backgroundColor = `rgb(255 255 255 / ${lit ? 0.02 : 0.01})`;
        },
        wake: () => recrop(video, box),
      })
      .finally(() => pixel.remove());
    undo.push(() => compositor.stop());
    // Unwinding stops sharing first, before the zoom back out.
    undo.push(() => stream.getTracks().forEach((track) => track.stop()));
    if (mixer && audio) mixer.add(audio);
    return { stage, camera, compositor, composed, unwind, actor, cursor, undo, box };
  } catch (error) {
    await unwind();
    throw error;
  }
}

/** A photo of the picked area, on its background, at the stage's resolution; `before` runs once it's staged (a timer). */
export async function takePhoto(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, before?: Before): Promise<Result> {
  const { stage, compositor, unwind } = await setUp(picked, settings, layers, image, null, null);
  try {
    await before?.(stage.screen);
    // A moment for the last redraw at the stage's scale to reach the capture.
    await wait(120);
    await nextFrame();
    const blob = await compositor.snapshot();
    return { kind: "photo", blob, type: "image/png", ...compositor.size };
  } finally {
    await unwind();
  }
}

const TYPES = ["video/mp4;codecs=avc1.640033", "video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

/** How long the camera stays close after the last click or key of a take by hand, in milliseconds. */
export const HOLD_MS = 1800;

/** Keys that scroll a page, and how far: a share of the frame, or to an end. */
const SCROLL_KEYS: Record<string, number | "top" | "bottom"> = { ArrowDown: 0.1, ArrowUp: -0.1, PageDown: 0.85, PageUp: -0.85, " ": 0.85, Home: "top", End: "bottom" };

/**
 * The camera in a take by hand: closing in on each click inside the frame (`level`, when it
 * closes in at all) and drawing back once nothing's been pressed or typed for a moment;
 * following the pointer while close, as a magnifier does, so what's under it is what was
 * under it before; and panning down the page when the wheel turns, or a key that scrolls is
 * pressed, where nothing in the page scrolls that way. Returns what takes it all away.
 */
function byHand(camera: Camera, layers: Layers, level: number, cursor: DrawnCursor | null) {
  const frame = camera.stage.screen;
  const inside = (q: Point) => q.x >= frame.x && q.x <= frame.x + frame.width && q.y >= frame.y && q.y <= frame.y + frame.height;
  let pressed = false;
  let timer = 0;
  let pointer: Point | null = null;
  const hold = () => {
    clearTimeout(timer);
    if (!pressed && camera.zoomed) timer = window.setTimeout(() => camera.zoomOut(), HOLD_MS);
  };
  const follow = () => {
    if (camera.zoomed && pointer) camera.focusOn(camera.under(pointer));
  };
  const onDown = (event: PointerEvent) => {
    const q = { x: event.clientX, y: event.clientY };
    if (level <= 1 || event.button !== 0 || layers.ignore(event.target) || !inside(q)) return;
    pressed = true;
    clearTimeout(timer);
    camera.zoomTo(camera.under(q), level);
  };
  const onUp = () => {
    if (!pressed) return;
    pressed = false;
    hold();
  };
  const onMove = (event: PointerEvent) => {
    pointer = { x: event.clientX, y: event.clientY };
    follow();
  };
  const onWheel = (event: WheelEvent) => {
    // A pinch is the browser's own zoom; Closeup's controls aren't the page.
    if (event.ctrlKey || layers.ignore(event.target)) return;
    const dy = wheelPixels(event);
    if (!dy || scrollerFor(event.target as Element, dy)) return;
    event.preventDefault();
    if (!camera.canPan(dy)) return;
    // Moved on screen as far as the wheel says, whatever the page's enlargement.
    camera.panBy(dy / camera.view.scale);
    follow();
    hold();
  };
  const onKey = (event: KeyboardEvent) => {
    if (layers.ignore(event.target)) return;
    hold();
    const by = SCROLL_KEYS[event.key];
    const active = document.activeElement;
    // Only what the page left alone, and never from a field or a control, which keep their keys.
    if (by === undefined || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    if (active && active !== document.body && active !== document.documentElement) return;
    event.preventDefault();
    const sign = event.shiftKey && event.key === " " ? -1 : 1;
    if (by === "top") camera.panBy(-Infinity);
    else if (by === "bottom") camera.panBy(Infinity);
    else camera.panBy((sign * by * frame.height) / camera.view.scale);
    follow();
  };
  // The drawn cursor follows the pointer on screen, so it's redrawn where it is as the page moves under it.
  const off = camera.onMove(() => {
    cursor?.zoom(camera.level);
    cursor?.refresh();
  });
  addEventListener("pointerdown", onDown, true);
  addEventListener("pointerup", onUp, true);
  addEventListener("pointercancel", onUp, true);
  addEventListener("pointermove", onMove, true);
  addEventListener("wheel", onWheel, { capture: true, passive: false });
  // After the page's own handlers, so what it does with a key comes first.
  addEventListener("keydown", onKey);
  return () => {
    clearTimeout(timer);
    off();
    removeEventListener("pointerdown", onDown, true);
    removeEventListener("pointerup", onUp, true);
    removeEventListener("pointercancel", onUp, true);
    removeEventListener("pointermove", onMove, true);
    removeEventListener("wheel", onWheel, true);
    removeEventListener("keydown", onKey);
  };
}

/**
 * Starts recording the picked area, the cursor following your mouse or, given a `script`,
 * playing it; `before` runs once the stage is set and before recording starts (a countdown);
 * `stop()` ends the take and puts the page back.
 */
export async function startVideo(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, script: Script | null = null, before?: Before, drawn = true): Promise<Running> {
  if (script && settings.render && canRender()) return renderVideo(picked, settings, layers, image, script, drawn);
  // Made in the click that started the take: audio started later can be refused.
  const mixer = settings.clicks || settings.tabAudio ? new Mixer() : null;
  let setup: Awaited<ReturnType<typeof setUp>>;
  try {
    setup = await setUp(picked, settings, layers, image, mixer, script, drawn);
  } catch (error) {
    mixer?.close();
    throw error;
  }
  const { stage, camera, compositor, composed, unwind, actor, cursor, undo } = setup;
  if (!script) undo.push(byHand(camera, layers, settings.zoom, cursor));
  try {
    await before?.(stage.screen);
  } catch (error) {
    await unwind();
    mixer?.close();
    throw error;
  }
  const tracks = [composed, ...(mixer ? [mixer.track] : [])];
  const type = TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? "";
  const recorder = new MediaRecorder(new MediaStream(tracks), {
    mimeType: type,
    videoBitsPerSecond: settings.quality === "high" ? 40_000_000 : 12_000_000,
  });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  recorder.start(500);
  const started = performance.now();
  let pausedAt = 0;
  let pausedFor = 0;
  const elapsed = () => ((pausedAt || performance.now()) - started - pausedFor) / 1000;

  const playing = new AbortController();
  const finished =
    actor && script
      ? play(script, {
          ...actor,
          camera,
          zoom: settings.zoom,
          onKey: mixer && settings.clicks ? () => mixer.key() : undefined,
          signal: playing.signal,
        }).then(() => wait(TAIL * 1000))
      : undefined;

  return {
    screen: stage.screen,
    elapsed,
    finished,
    get paused() {
      return recorder.state === "paused";
    },
    pause() {
      if (script || recorder.state !== "recording") return;
      recorder.pause();
      pausedAt = performance.now();
    },
    resume() {
      if (recorder.state !== "paused") return;
      recorder.resume();
      pausedFor += performance.now() - pausedAt;
      pausedAt = 0;
    },
    async stop() {
      playing.abort();
      const seconds = elapsed();
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const size = compositor.size;
      await unwind();
      mixer?.close();
      const blobType = type.split(";")[0] || "video/webm";
      // A regular MP4 rather than the recorder's fragments: it seeks, and says how long it is, everywhere.
      const blob = await regular(new Blob(chunks, { type: blobType }));
      return { kind: "video", blob, type: blobType, ...size, seconds, ...(script ? { script } : {}) };
    },
  };
}

/** Frames a second in a rendered take. */
export const RENDER_FPS = 60;
/** The longest a rendered take runs: a script that never ends is stopped here. */
const RENDER_MOST = 10 * 60 * RENDER_FPS;
/** An MP4 the recorder can write, where a take can't be encoded (`FrameEncoder`): its frames are given their length once it's made, which only an MP4 lets them. */
const RENDER_TYPES = ["video/mp4;codecs=avc1.640033", "video/mp4;codecs=avc1", "video/mp4"];

const canRecordMp4 = () => typeof MediaRecorder !== "undefined" && RENDER_TYPES.some((type) => MediaRecorder.isTypeSupported(type));

/**
 * Whether this browser can render a take: a video's frames handed over one by one, and a way to
 * make them an MP4, an encoder (WebCodecs) or else a recorder. Whether the encoder takes the
 * take's size is known only once it's staged: where it doesn't, the take is recorded.
 */
export const canRender = () =>
  (typeof VideoEncoder !== "undefined" || canRecordMp4()) && typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

type CanvasTrack = MediaStreamTrack & { requestFrame(): void };

/**
 * Where a take can't be encoded: the canvas recorded a frame at a time, each frame given a
 * sixtieth of a second once the take is made (`regular`'s `frame`). The recorder takes frames at
 * whatever pace they come and can leave out those its encoder doesn't keep up with. Null without
 * an MP4 recorder.
 */
function recordFrames(canvas: HTMLCanvasElement, bitrate: number) {
  const type = canRecordMp4() ? RENDER_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) : undefined;
  if (!type) return null;
  const output = canvas.captureStream(0).getVideoTracks()[0] as CanvasTrack;
  const recorder = new MediaRecorder(new MediaStream([output]), { mimeType: type, videoBitsPerSecond: bitrate });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
  recorder.start(500);
  return {
    frame: () => output.requestFrame(),
    async finish() {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      // Each frame a sixtieth of a second, however long it took to make.
      return regular(new Blob(chunks, { type: "video/mp4" }), { frame: 1 / RENDER_FPS });
    },
    close() {
      if (recorder.state !== "inactive") recorder.stop();
      output.stop();
    },
  };
}

/**
 * A scripted take made a frame at a time (Render). Staged and played as a live take is, but on a
 * clock Closeup holds (`clock.ts`): from the moment it starts, time moves on a sixtieth of a second,
 * the page draws that moment, and once the tab has sent a picture taken after it (`frameAfter`),
 * that picture is the take's next frame. However slowly the page draws, every frame is its own
 * moment: the motion is even on any machine. Each frame is encoded (`FrameEncoder`) before the
 * next is made, so however slowly the machine encodes, none is left out; where the browser can't
 * encode the take, it's recorded instead (`recordFrames`). Silent.
 */
async function renderVideo(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, script: Script, drawn = true): Promise<Running> {
  const { stage, camera, compositor, unwind, actor, box } = await setUp(picked, settings, layers, image, null, script, drawn);
  const bitrate = settings.quality === "high" ? 40_000_000 : 12_000_000;
  const encoder = await FrameEncoder.open({ ...compositor.size, fps: RENDER_FPS, bitrate });
  const recording = encoder ? null : recordFrames(compositor.canvas, bitrate);
  if (!encoder && !recording) {
    await unwind();
    throw new Error("this browser can't make a video of this size a frame at a time");
  }

  // A pixel in the frame's corner (where the corners clip it on a background) changed every step,
  // so the tab sends a picture even when nothing else moved.
  const pixel = document.createElement("div");
  Object.assign(pixel.style, { position: "absolute", left: "0", top: "0", width: "1px", height: "1px" });
  box.append(pixel);
  let lit = false;

  const clock = takeTime();
  const playing = new AbortController();
  let played = false;
  let stopping = false;
  let frames = 0;
  // Kept for `stop()` to throw, once the page is put back: what waits for the take to end never fails.
  let failure: unknown = null;
  const done = play(script, { ...actor!, camera, zoom: settings.zoom, signal: playing.signal })
    .then(() => wait(TAIL * 1000))
    .catch(() => {})
    .finally(() => (played = true));
  void done;
  const rendered = (async () => {
    try {
      for (;;) {
        lit = !lit;
        pixel.style.backgroundColor = `rgb(255 255 255 / ${lit ? 0.02 : 0.01})`;
        // Only a picture the tab took once this moment was on screen will do.
        await painted();
        await compositor.frameAfter(realNow(), 250);
        // Encoded before the next moment is drawn: waits while the encoder catches up.
        if (encoder) await encoder.add(compositor.canvas);
        else recording!.frame();
        frames++;
        if (played || stopping || frames >= RENDER_MOST) return;
        await clock.step(1000 / RENDER_FPS);
        // What the page does about the new moment (React drawing it, new animations) gets in, then is held too.
        await settle();
        clock.hold();
      }
    } catch (error) {
      failure = error;
    }
  })();

  return {
    screen: stage.screen,
    elapsed: () => frames / RENDER_FPS,
    rendering: true,
    finished: rendered,
    get paused() {
      return false;
    },
    pause() {},
    resume() {},
    async stop() {
      stopping = true;
      playing.abort();
      await rendered;
      const size = encoder ? encoder.size : compositor.size;
      try {
        if (failure) throw failure;
        const blob = encoder ? await encoder.finish() : await recording!.finish();
        return { kind: "video", blob, type: "video/mp4", ...size, seconds: frames / RENDER_FPS, script };
      } finally {
        encoder?.close();
        recording?.close();
        clock.release();
        pixel.remove();
        await unwind();
      }
    },
  };
}
