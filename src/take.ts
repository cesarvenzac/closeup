/**
 * A take, start to end: share this tab, put the picked area on stage, crop the capture to it,
 * draw the cursor (following your mouse, or played from a script), compose the frames on their
 * background, and record them (with the clicks and the tab's sound) or keep one as a photo.
 * Everything is put back afterwards, in order.
 */

import { cropTo, recrop, shareTab } from "./capture.ts";
import { type Background, Compositor, type Look } from "./compositor.ts";
import { DrawnCursor } from "./cursor.ts";
import { fillFor, frameAround, type Rect, SHAPES, stageFor, toScreen } from "./frame.ts";
import { emulateHover } from "./hover.ts";
import { play } from "./player.ts";
import { SyntheticPointer } from "./pointer.ts";
import { type Script, TAIL } from "./script.ts";
import { GRADIENTS, type Settings } from "./settings.ts";
import { Mixer } from "./sounds.ts";
import { enterStage, nextFrame, wait } from "./stage.ts";

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
  started: number;
  /** For a scripted take: settles once the script has played and the cursor has lingered. */
  finished?: Promise<void>;
  stop(): Promise<Result>;
};

export const toRect = ({ x, y, width, height }: DOMRectReadOnly): Rect => ({ x, y, width, height });

/** What a take films: an element with room round it, a drawn region as drawn, either one to the chosen shape. */
export const frameOf = (rect: Rect, element: Element | null, settings: Settings) =>
  frameAround(rect, element ? settings.padding : 0, SHAPES[settings.shape]);

function lookOf(settings: Settings, image: ImageBitmap | null): Look {
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

/** What plays a script: the drawn cursor, and the pointer the page is told about. */
export type Actor = { cursor: DrawnCursor; pointer: SyntheticPointer; dispose(): void };

/**
 * What plays a script, set up over the page: a clear sheet that keeps the real mouse off it (so
 * nothing under it hovers) with the real cursor hidden, the page's hover rules copied for the
 * drawn cursor, the pointer the page is told about, and the cursor. `dispose()` takes it all away,
 * telling the page the pointer left so what it hovers lets go.
 */
export function createActor(layers: Layers, { size, onPress, ring }: { size: number; onPress?: (down: boolean) => void; ring?: boolean }): Actor {
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
    dispose() {
      pointer.leave();
      cursor.destroy();
      hover.remove();
      shield.remove();
    },
  };
}

async function setUp(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, mixer: Mixer | null, script: Script | null) {
  const { host, ignore } = layers;
  const undo: Undo[] = [];
  const hit = pageHit(layers);
  const onPress = mixer && settings.clicks ? (down: boolean) => mixer.click(down) : undefined;
  let actor: Actor | null = null;
  const unwind = async () => {
    for (const step of undo.reverse()) await step();
  };
  try {
    const { stream, video, audio } = await shareTab({ audio: settings.mode === "video" && settings.tabAudio });
    undo.push(() => stream.getTracks().forEach((track) => track.stop()));
    // Measured now: the page may have moved since the pick.
    const rect = picked.element?.isConnected ? toRect(picked.element.getBoundingClientRect()) : picked.rect;
    const frame = frameOf(rect, picked.element, settings);
    const viewport = { width: innerWidth, height: innerHeight };
    const stage = stageFor(frame, viewport, fillFor(viewport), { x: scrollX, y: scrollY });
    const leave = await enterStage(stage);
    undo.push(leave);
    const box = frameBox(stage.screen, host);
    undo.push(() => box.remove());
    await cropTo(video, box);
    if (script) {
      actor = createActor(layers, { size: settings.cursorSize, onPress, ring: settings.ring });
      undo.push(() => actor?.dispose());
    } else if (settings.cursor) {
      const cursor = new DrawnCursor(host, { size: settings.cursorSize, onPress, ring: settings.ring, ignore, hit });
      cursor.follow();
      undo.push(() => cursor.destroy());
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
    return { stage, compositor, composed, unwind, actor };
  } catch (error) {
    await unwind();
    throw error;
  }
}

/** A photo of the picked area, on its background, at the stage's resolution. */
export async function takePhoto(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null): Promise<Result> {
  const { compositor, unwind } = await setUp(picked, settings, layers, image, null, null);
  try {
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

/**
 * Starts recording the picked area, the cursor following your mouse or, given a `script`,
 * playing it; `stop()` ends the take and puts the page back.
 */
export async function startVideo(picked: Picked, settings: Settings, layers: Layers, image: ImageBitmap | null, script: Script | null = null): Promise<Running> {
  // Made in the click that started the take: audio started later can be refused.
  const mixer = settings.clicks || settings.tabAudio ? new Mixer() : null;
  let setup: Awaited<ReturnType<typeof setUp>>;
  try {
    setup = await setUp(picked, settings, layers, image, mixer, script);
  } catch (error) {
    mixer?.close();
    throw error;
  }
  const { stage, compositor, composed, unwind, actor } = setup;
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

  const playing = new AbortController();
  const finished =
    actor && script
      ? play(script, {
          ...actor,
          toScreen: (p) => toScreen(stage, { x: scrollX, y: scrollY }, p),
          scale: stage.scale,
          onKey: mixer && settings.clicks ? () => mixer.key() : undefined,
          signal: playing.signal,
        }).then(() => wait(TAIL * 1000))
      : undefined;

  return {
    screen: stage.screen,
    started,
    finished,
    async stop() {
      playing.abort();
      const seconds = (performance.now() - started) / 1000;
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      const size = compositor.size;
      await unwind();
      mixer?.close();
      const blobType = type.split(";")[0] || "video/webm";
      return { kind: "video", blob: new Blob(chunks, { type: blobType }), type: blobType, ...size, seconds, ...(script ? { script } : {}) };
    },
  };
}
