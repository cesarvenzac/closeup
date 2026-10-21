/**
 * A finished take as it's kept: trimmed and at its speed, as a video or a GIF. A video is played
 * through once at its speed, from where it starts to where it ends, and recorded again (sound
 * included, its pitch kept); a GIF is stepped through a frame at a time and drawn with one
 * palette (`gif.ts`). Either way the take's own file is left as it was.
 */

import { type Edit, GIF_FPS, GIF_WIDTH, gifFrames, gifSize, lengthOf } from "./edit.ts";
import { GifWriter, Indexer, paletteOf } from "./gif.ts";
import { defragment, isFragmented } from "./mp4.ts";
import type { Result } from "./take.ts";

export type Progress = { progress?: (done: number) => void; signal?: AbortSignal };

const aborted = () => new DOMException("The export was called off", "AbortError");

/** A take's video, hidden but laid out (so the browser keeps decoding it), ready to play or seek. */
async function videoOf(take: Result, host: Element) {
  const url = URL.createObjectURL(take.blob);
  const video = document.createElement("video");
  video.playsInline = true;
  video.preload = "auto";
  Object.assign(video.style, { position: "fixed", left: "0", top: "0", width: "2px", height: "2px", opacity: "0", pointerEvents: "none" });
  host.append(video);
  const dispose = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
    URL.revokeObjectURL(url);
  };
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("the take couldn't be read back"));
      video.src = url;
    });
  } catch (error) {
    dispose();
    throw error;
  }
  return { video, dispose };
}

/** Moves a video to `t` seconds and waits for that frame. */
export function seek(video: HTMLVideoElement, t: number) {
  return new Promise<void>((resolve) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve();
    const done = () => {
      clearTimeout(timer);
      video.removeEventListener("seeked", done);
      resolve();
    };
    // A seek that never says it's done still lets the export go on.
    const timer = setTimeout(done, 2000);
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

/** The recorder's output made a regular MP4 when it can be (`mp4.ts`), else as it was. */
export async function regular(blob: Blob): Promise<Blob> {
  if (!blob.type.includes("mp4")) return blob;
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (!isFragmented(bytes)) return blob;
    const fixed = defragment(bytes);
    return fixed ? new Blob([fixed.buffer as ArrayBuffer], { type: blob.type }) : blob;
  } catch {
    return blob;
  }
}

type VideoFrame = { mediaTime: number };
type FrameVideo = HTMLVideoElement & {
  captureStream(): MediaStream;
  requestVideoFrameCallback(callback: (now: number, frame: VideoFrame) => void): number;
  cancelVideoFrameCallback(id: number): void;
};

/**
 * The take trimmed to `edit` and played at its speed, as a new video: played through once and
 * recorded again, so it takes as long as the edited take lasts. The same type as the take, at
 * `bitrate`.
 */
export async function editedVideo(take: Result, edit: Edit, host: Element, { progress, signal, bitrate = 40_000_000 }: Progress & { bitrate?: number } = {}): Promise<Result> {
  const { video, dispose } = await videoOf(take, host);
  const sound = new AudioContext();
  try {
    if (signal?.aborted) throw aborted();
    // Its sound into the recording only: the speakers stay quiet.
    const destination = sound.createMediaStreamDestination();
    sound.createMediaElementSource(video).connect(destination);
    await sound.resume().catch(() => undefined);
    video.preservesPitch = true;
    video.playbackRate = edit.speed;
    await seek(video, edit.from);
    const picture = (video as FrameVideo).captureStream().getVideoTracks()[0];
    const stream = new MediaStream([picture, ...destination.stream.getAudioTracks()]);
    const recorder = new MediaRecorder(stream, { mimeType: take.type.split(";")[0], videoBitsPerSecond: bitrate });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
    const stopped = new Promise<void>((resolve) => (recorder.onstop = () => resolve()));
    recorder.start(500);
    await video.play();
    await new Promise<void>((resolve, reject) => {
      const frames = video as FrameVideo;
      let id = 0;
      const finish = () => {
        frames.cancelVideoFrameCallback(id);
        video.removeEventListener("ended", finish);
        signal?.removeEventListener("abort", stop);
        resolve();
      };
      const stop = () => {
        frames.cancelVideoFrameCallback(id);
        video.removeEventListener("ended", finish);
        reject(aborted());
      };
      const tick = (_: number, frame: VideoFrame) => {
        progress?.(Math.min(1, (frame.mediaTime - edit.from) / Math.max(0.001, edit.to - edit.from)));
        if (frame.mediaTime >= edit.to) return finish();
        id = frames.requestVideoFrameCallback(tick);
      };
      id = frames.requestVideoFrameCallback(tick);
      video.addEventListener("ended", finish);
      signal?.addEventListener("abort", stop, { once: true });
    }).finally(() => {
      video.pause();
      recorder.stop();
    });
    await stopped;
    const type = recorder.mimeType.split(";")[0] || take.type;
    const blob = await regular(new Blob(chunks, { type }));
    progress?.(1);
    return { ...take, blob, type, seconds: lengthOf(edit) };
  } finally {
    void sound.close().catch(() => undefined);
    dispose();
  }
}

/** How many frames of the take the GIF's palette is made from: spread through it. */
const PALETTE_FRAMES = 8;

/**
 * The take trimmed to `edit` and at its speed as an animated GIF, `fps` frames a second, no wider
 * than `width`. Each frame is found by seeking, so nothing is dropped however busy the page is.
 */
export async function gifOf(take: Result, edit: Edit, host: Element, { progress, signal, width = GIF_WIDTH, fps = GIF_FPS }: Progress & { width?: number; fps?: number } = {}): Promise<Blob> {
  const { video, dispose } = await videoOf(take, host);
  try {
    video.muted = true;
    const size = gifSize(take.width || video.videoWidth, take.height || video.videoHeight, width);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { willReadFrequently: true })!;
    context.imageSmoothingQuality = "high";
    const grab = async (t: number) => {
      if (signal?.aborted) throw aborted();
      await seek(video, t);
      context.drawImage(video, 0, 0, size.width, size.height);
      return context.getImageData(0, 0, size.width, size.height).data;
    };
    const frames = gifFrames(edit, fps);
    const samples: Uint8ClampedArray[] = [];
    const count = Math.min(PALETTE_FRAMES, frames.length);
    for (let k = 0; k < count; k++) samples.push(await grab(frames[Math.round((k * (frames.length - 1)) / Math.max(1, count - 1))].at));
    const palette = paletteOf(samples);
    const indexer = new Indexer(palette);
    const writer = new GifWriter(size.width, size.height, palette);
    for (const [k, frame] of frames.entries()) {
      writer.frame(indexer.indices(await grab(frame.at)), frame.delay);
      progress?.((k + 1) / frames.length);
    }
    return new Blob([writer.done().buffer as ArrayBuffer], { type: "image/gif" });
  } finally {
    dispose();
  }
}

/**
 * Frames of the take side by side across `canvas`, as many as fit at its height and the take's
 * shape, for the trim bar to stand on. Drawn from a video of its own, so the preview plays on.
 */
export async function filmstrip(take: Result, host: Element, canvas: HTMLCanvasElement, signal?: AbortSignal) {
  const { video, dispose } = await videoOf(take, host);
  try {
    video.muted = true;
    const context = canvas.getContext("2d")!;
    const aspect = (take.width || video.videoWidth) / (take.height || video.videoHeight) || 16 / 9;
    const tile = Math.max(1, canvas.height * aspect);
    const count = Math.max(1, Math.ceil(canvas.width / tile));
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : take.seconds ?? 0;
    for (let k = 0; k < count; k++) {
      if (signal?.aborted) return;
      await seek(video, Math.min(duration - 0.01, ((k + 0.5) / count) * duration));
      context.drawImage(video, k * tile, 0, tile, canvas.height);
    }
  } finally {
    dispose();
  }
}
