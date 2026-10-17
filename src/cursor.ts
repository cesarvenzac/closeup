/**
 * A drawn cursor in place of the real one while a take lasts. Chrome adds the real cursor to a
 * tab capture as a small, soft picture laid on top, which stage mode can't sharpen; this one is
 * drawn by the page at the screen's full resolution. It takes the shape the real one would
 * have there (the hand over links and buttons, the I-beam over text, else the arrow) and
 * presses a little on a click. It lives outside <body>, so stage mode doesn't enlarge it.
 */

import { CURSORS, type CursorShape } from "./cursors.ts";

export type CursorOptions = {
  /** How big it's drawn, in CSS pixels across its 24-unit box. */
  size: number;
  /** Each press and release, for the click sound. */
  onPress?: (down: boolean) => void;
  /** A soft ring that spreads from the tip on each click, so a viewer sees it. */
  ring?: boolean;
  /** Events over Closeup's own controls: the real cursor shows there, the drawn one hides. */
  ignore?: (target: EventTarget | null) => boolean;
  /** The page's element at a point, Closeup's own layers left out. */
  hit: (x: number, y: number) => Element | null;
  /** Where a caret would go at a point, Closeup's own layers left out (to tell text from space). */
  caretAt?: (x: number, y: number) => Range | null;
};

export class DrawnCursor {
  private readonly element = document.createElement("div");
  private readonly hide = document.createElement("style");
  private shape: CursorShape | null = null;
  private shown = false;
  private x = 0;
  private y = 0;

  constructor(
    private readonly host: Element,
    private readonly options: CursorOptions,
  ) {
    this.hide.textContent = "*, *::before, *::after { cursor: none !important; }";
    Object.assign(this.element.style, {
      position: "fixed",
      left: "0",
      top: "0",
      width: `${options.size}px`,
      height: `${options.size}px`,
      pointerEvents: "none",
      zIndex: "2147483646",
      visibility: "hidden",
      filter: "drop-shadow(0 1.5px 2.5px rgb(0 0 0 / 0.3))",
      transition: "scale 90ms ease-out",
    });
  }

  /** Puts it on the page, hiding the real cursor there; it appears at its first `place`. */
  show() {
    if (this.shown) return;
    this.shown = true;
    document.head.append(this.hide);
    this.host.append(this.element);
  }

  /** Follows the real pointer. */
  follow() {
    this.show();
    addEventListener("pointermove", this.onMove, true);
    addEventListener("pointerdown", this.onDown, true);
    addEventListener("pointerup", this.onUp, true);
    document.addEventListener("pointerout", this.onLeave, true);
  }

  destroy() {
    removeEventListener("pointermove", this.onMove, true);
    removeEventListener("pointerdown", this.onDown, true);
    removeEventListener("pointerup", this.onUp, true);
    document.removeEventListener("pointerout", this.onLeave, true);
    this.hide.remove();
    this.element.remove();
    this.shown = false;
  }

  /** Draws it at a point on screen, in the shape the real cursor would take there. */
  place(x: number, y: number) {
    this.x = x;
    this.y = y;
    const shape = this.shapeAt(x, y);
    const { hot, svg } = CURSORS[shape];
    const size = this.options.size;
    if (shape !== this.shape) {
      this.element.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="display:block;overflow:visible">${svg}</svg>`;
      this.shape = shape;
    }
    const unit = size / 24;
    this.element.style.translate = `${x - hot[0] * unit}px ${y - hot[1] * unit}px`;
    this.element.style.transformOrigin = `${hot[0] * unit}px ${hot[1] * unit}px`;
    this.element.style.visibility = "visible";
  }

  /** Presses a little going down, and back coming up, with the click's sound (and the ring, going down). */
  press(down: boolean) {
    this.element.style.scale = down ? "0.86" : "1";
    this.options.onPress?.(down);
    if (down && this.options.ring) this.ripple();
  }

  /** The ring: from the tip, out to about the cursor's size, fading as it goes. Still under reduced motion. */
  private ripple() {
    const size = this.options.size * 1.5;
    const ring = document.createElement("div");
    Object.assign(ring.style, {
      position: "fixed",
      left: `${this.x - size / 2}px`,
      top: `${this.y - size / 2}px`,
      width: `${size}px`,
      height: `${size}px`,
      borderRadius: "50%",
      pointerEvents: "none",
      zIndex: "2147483645",
      // A dark edge with a light halo, so it shows on light pages and dark ones.
      background: "rgb(0 0 0 / 0.07)",
      boxShadow: "inset 0 0 0 2px rgb(0 0 0 / 0.32), 0 0 0 1.5px rgb(255 255 255 / 0.55)",
    });
    this.host.append(ring);
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frames = still ? [{ opacity: 1 }, { opacity: 0 }] : [{ scale: 0.2, opacity: 1 }, { scale: 1, opacity: 0 }];
    ring.animate(frames, { duration: still ? 360 : 560, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }).finished.finally(() => ring.remove());
  }

  private onMove = (event: PointerEvent) => {
    if (this.options.ignore?.(event.target)) this.element.style.visibility = "hidden";
    else this.place(event.clientX, event.clientY);
  };

  private onDown = (event: PointerEvent) => {
    if (!this.options.ignore?.(event.target)) this.press(true);
  };

  private onUp = (event: PointerEvent) => {
    if (!this.options.ignore?.(event.target)) this.press(false);
  };

  private onLeave = (event: PointerEvent) => {
    if (!event.relatedTarget) this.element.style.visibility = "hidden";
  };

  /** The shape the real cursor would take here: read with the hiding rule off for a moment. */
  private shapeAt(x: number, y: number): CursorShape {
    const under = this.options.hit(x, y);
    if (!under) return "arrow";
    this.hide.disabled = true;
    const style = getComputedStyle(under);
    const cursor = style.cursor;
    const userSelect = style.userSelect;
    this.hide.disabled = false;
    if (cursor === "pointer") return "hand";
    if (cursor === "text" || cursor === "vertical-text") return "text";
    if (cursor !== "auto" || userSelect === "none") return "arrow";
    if (under.matches("input, textarea, [contenteditable='true'], [contenteditable='']")) return "text";
    // Over text a browser shows the I-beam: is the point on a line of text?
    const caret = this.options.caretAt ? this.options.caretAt(x, y) : document.caretRangeFromPoint?.(x, y);
    if (caret?.startContainer.nodeType === Node.TEXT_NODE) {
      const range = document.createRange();
      range.selectNodeContents(caret.startContainer);
      for (const rect of range.getClientRects()) if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return "text";
    }
    return "arrow";
  }
}
