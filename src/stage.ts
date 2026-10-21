import type { Stage } from "./frame.ts";

/** The zoom into the stage and back out: entering eases out over a moment, leaving is quicker. */
const ENTER_MS = 420;
const LEAVE_MS = 260;
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * The page laid out as the stage will lay it out, so what's measured now is where the stage shows
 * it: scrolling locked (a scrollbar taken away moves what's centred), and a transform on <body>
 * that changes nothing drawn but makes <body> the box that parts fixed to the window, and parts
 * placed absolutely with nothing else to go by, are placed in. Returns what puts the page back.
 */
export function holdStill(): () => void {
  const root = document.documentElement;
  const body = document.body;
  const saved = { overflow: root.style.overflow, transform: body.style.transform };
  root.style.overflow = "hidden";
  if (getComputedStyle(body).transform === "none") body.style.transform = "translate(0px, 0px)";
  return () => {
    root.style.overflow = saved.overflow;
    body.style.transform = saved.transform;
  };
}

/**
 * Puts the page on stage: <body> scaled and moved so the frame fills the middle of the window,
 * the browser drawing it at that size (sharp, not an enlarged capture), scrolling locked. The
 * layout doesn't change, only how big it's drawn. Everything Closeup adds lives outside <body>,
 * so it stays put. Resolves once the zoom has settled; the returned function puts it all back.
 */
export async function enterStage(stage: Stage, { animate = true } = {}): Promise<() => Promise<void>> {
  const root = document.documentElement;
  const body = document.body;
  const saved = {
    overflow: root.style.overflow,
    transform: body.style.transform,
    origin: body.style.transformOrigin,
    transition: body.style.transition,
    willChange: body.style.willChange,
  };
  // Scaled about the document's top left, wherever <body> starts: a margin round it (browsers
  // give it 8px unless told otherwise) would otherwise put the frame that much times the scale off.
  const box = body.getBoundingClientRect();
  root.style.overflow = "hidden";
  body.style.transformOrigin = `${-(box.left + scrollX)}px ${-(box.top + scrollY)}px`;
  const target = `translate(${stage.tx}px, ${stage.ty}px) scale(${stage.scale})`;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (animate && !reduced) {
    body.style.transition = `transform ${ENTER_MS}ms ${EASE}`;
    body.style.transform = "translate(0px, 0px) scale(1)";
    // One frame at the start, so the transition has somewhere to come from.
    await nextFrame();
    body.style.transform = target;
    await wait(ENTER_MS + 30);
    body.style.transition = saved.transition;
  } else body.style.transform = target;
  // No will-change: with it Chrome may keep drawing at the old scale, and the point is drawing at the new one.
  await nextFrame();
  await nextFrame();

  return async () => {
    if (animate && !reduced) {
      body.style.transition = `transform ${LEAVE_MS}ms ${EASE}`;
      body.style.transform = "translate(0px, 0px) scale(1)";
      await wait(LEAVE_MS + 30);
    }
    root.style.overflow = saved.overflow;
    body.style.transform = saved.transform;
    body.style.transformOrigin = saved.origin;
    body.style.transition = saved.transition;
    body.style.willChange = saved.willChange;
  };
}

export const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
export const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
