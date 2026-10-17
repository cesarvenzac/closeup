/**
 * This tab as a video track, cropped to one element by Region Capture: what's on screen inside
 * the element's box, exactly as drawn (3D canvases and video included), and nothing else, so
 * Closeup's own controls outside it never show. Chromium only, for now.
 */

type CropTargetLike = object;
type CroppableTrack = MediaStreamTrack & { cropTo(target: CropTargetLike | null): Promise<void> };
declare const CropTarget: { fromElement(element: Element): Promise<CropTargetLike> } | undefined;

/** Whether this browser can share a tab and crop it to an element (cropTo lives on the captured track's own class). */
export const supportsCapture = () =>
  typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia && typeof CropTarget !== "undefined";

/**
 * Asks to share this tab. Must run in the click that asked for it: browsers refuse a capture
 * started without a gesture. `audio` offers the tab's own sound too (Chrome shows a checkbox).
 */
export async function shareTab({ audio, frameRate = 60 }: { audio: boolean; frameRate?: number }) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    // As large as the tab's real pixels: the crop is taken from these.
    video: { frameRate: { ideal: frameRate, max: frameRate }, width: { ideal: 8192 }, height: { ideal: 8192 } },
    audio,
    // Not standard everywhere yet; Chrome reads them.
    ...({ preferCurrentTab: true, selfBrowserSurface: "include", systemAudio: "exclude" } as object),
  } as DisplayMediaStreamOptions);
  const [video] = stream.getVideoTracks();
  return { stream, video: video as CroppableTrack, audio: stream.getAudioTracks()[0] ?? null };
}

/** Crops the captured tab to `element`'s box, wherever it is on screen. */
export async function cropTo(track: MediaStreamTrack, element: Element) {
  if (typeof CropTarget === "undefined") throw new Error("This browser can't crop a capture (Region Capture is Chromium's)");
  await (track as CroppableTrack).cropTo(await CropTarget.fromElement(element));
}

/** Crops again from scratch: a capture cropped as it starts can stay silent, and this wakes it. */
export async function recrop(track: MediaStreamTrack, element: Element) {
  await (track as CroppableTrack).cropTo(null);
  await cropTo(track, element);
}
