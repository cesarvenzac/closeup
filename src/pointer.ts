/**
 * A pointer the page believes in: the events a mouse would send as the drawn cursor moves and
 * presses (pointer events, then the mouse events browsers send after them), so the page's own
 * code reacts as it would to a hand: hover effects, a cloud turning to look, a button pressed.
 * Over and out carry the element left or entered, as React builds its enter and leave events
 * from them; enter and leave go to each element crossed. Hover and press are also marked for
 * CSS (`hover.ts`). The events aren't trusted, so a page that checks `isTrusted` ignores them.
 */

import { ACTIVE, HOVER } from "./hover.ts";

type Hit = (x: number, y: number) => Element | null;

const FOCUSABLE = "a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]:not([contenteditable='false'])";

/** An element and its ancestors, nearest first. */
function chain(element: Element | null): Element[] {
  const out: Element[] = [];
  for (let e = element; e; e = e.parentElement) out.push(e);
  return out;
}

export class SyntheticPointer {
  private over: Element | null = null;
  private pressed: Element | null = null;
  private x = 0;
  private y = 0;
  private buttons = 0;

  /** `hit` finds the page's element at a point, Closeup's own layers left out. */
  constructor(private readonly hit: Hit) {}

  /** Moves to a point on screen: over, out, enter and leave where the element under it changes, then a move. */
  moveTo(x: number, y: number) {
    const target = this.hit(x, y) ?? document.documentElement;
    const moved = { x: x - this.x, y: y - this.y };
    this.x = x;
    this.y = y;
    if (target !== this.over) this.cross(target);
    this.send(target, "pointermove", { movementX: moved.x, movementY: moved.y });
    this.send(target, "mousemove", { movementX: moved.x, movementY: moved.y });
  }

  /** The button goes down here: the press, focus to what takes it, and :active on the way up the tree. */
  down() {
    const target = this.over ?? document.documentElement;
    this.buttons = 1;
    this.pressed = target;
    this.send(target, "pointerdown");
    this.send(target, "mousedown");
    const focusable = target.closest(FOCUSABLE) as HTMLElement | null;
    if (focusable) focusable.focus({ preventScroll: true });
    else if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
    for (const element of chain(focusable ?? target)) element.setAttribute(ACTIVE, "");
  }

  /** The button comes up: the release, and a click if it's still over what it pressed. */
  up() {
    const target = this.over ?? document.documentElement;
    this.buttons = 0;
    this.send(target, "pointerup");
    this.send(target, "mouseup");
    for (const element of document.querySelectorAll(`[${ACTIVE}]`)) element.removeAttribute(ACTIVE);
    const pressed = this.pressed;
    this.pressed = null;
    if (!pressed) return;
    // As browsers do: the click goes to the nearest element holding both the press and the release.
    const common = chain(pressed).find((element) => element.contains(target));
    if (common) this.send(common, "click", { detail: 1 });
  }

  /** Leaves the page: out and leave to everything under the pointer, as when the mouse goes off the window. */
  leave() {
    this.cross(null);
  }

  private cross(target: Element | null) {
    const from = this.over;
    const left = chain(from);
    const entered = chain(target);
    const stays = new Set(left.filter((element) => entered.includes(element)));
    if (from) {
      this.send(from, "pointerout", { relatedTarget: target });
      for (const element of left) if (!stays.has(element)) this.send(element, "pointerleave", { relatedTarget: target, bubbles: false });
      this.send(from, "mouseout", { relatedTarget: target });
      for (const element of left) if (!stays.has(element)) this.send(element, "mouseleave", { relatedTarget: target, bubbles: false });
    }
    for (const element of left) if (!stays.has(element)) element.removeAttribute(HOVER);
    if (target) {
      this.send(target, "pointerover", { relatedTarget: from });
      for (const element of [...entered].reverse()) if (!stays.has(element)) this.send(element, "pointerenter", { relatedTarget: from, bubbles: false });
      this.send(target, "mouseover", { relatedTarget: from });
      for (const element of [...entered].reverse()) if (!stays.has(element)) this.send(element, "mouseenter", { relatedTarget: from, bubbles: false });
    }
    for (const element of entered) element.setAttribute(HOVER, "");
    this.over = target;
  }

  private send(target: Element, type: string, extra: { relatedTarget?: Element | null; bubbles?: boolean; detail?: number; movementX?: number; movementY?: number } = {}) {
    const init: PointerEventInit = {
      bubbles: extra.bubbles ?? true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: this.x,
      clientY: this.y,
      screenX: this.x + window.screenX,
      screenY: this.y + window.screenY,
      button: type.endsWith("down") || type.endsWith("up") || type === "click" ? 0 : -1,
      buttons: this.buttons,
      relatedTarget: extra.relatedTarget ?? null,
      detail: extra.detail ?? 0,
      movementX: extra.movementX ?? 0,
      movementY: extra.movementY ?? 0,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
      width: 1,
      height: 1,
      pressure: this.buttons ? 0.5 : 0,
    };
    const event = type.startsWith("pointer") ? new PointerEvent(type, init) : new MouseEvent(type, { ...init, button: Math.max(0, init.button ?? 0) });
    target.dispatchEvent(event);
  }
}
