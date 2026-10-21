/**
 * What a wheel turned over the page scrolls. The page's own root is locked while staged (the
 * camera pans instead), but a part of the page that scrolls by itself, a list or a code block,
 * still takes the wheel first, as it would anyway.
 */

/** A wheel event's turn in CSS pixels, whichever unit it came in. */
export function wheelPixels(event: WheelEvent) {
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
  return event.deltaY * unit;
}

/** The element's parent, through a shadow root's host. */
const parentOf = (element: Element): Element | null => element.parentElement ?? ((element.getRootNode() as ShadowRoot).host || null);

/**
 * The nearest element at or above `from` that scrolls down (for a positive `dy`) or up, and
 * has room to go that way; null when only the page itself would.
 */
export function scrollerFor(from: Element | null, dy: number): Element | null {
  for (let element = from; element && element !== document.body && element !== document.documentElement; element = parentOf(element)) {
    if (element.scrollHeight <= element.clientHeight + 1) continue;
    const overflow = getComputedStyle(element).overflowY;
    if (overflow !== "auto" && overflow !== "scroll" && overflow !== "overlay") continue;
    const room = dy > 0 ? element.scrollHeight - element.clientHeight - element.scrollTop : element.scrollTop;
    if (room > 1) return element;
  }
  return null;
}
