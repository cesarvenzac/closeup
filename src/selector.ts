/**
 * Naming elements so a script can find them again: what a placed point is on, as a CSS
 * selector that still finds that element after a reload. Classes that only style (Tailwind's
 * and the like) and ids a framework makes up per render are passed over: they change between
 * builds, or say nothing about what the element is.
 */

/** Utility classes say how something looks, not what it is. */
const UTILITY =
  /[[\]:/.]|^-?(?:[mp][xytrbl]?|w|h|min|max|gap|text|bg|border|rounded|items|justify|self|place|font|leading|tracking|basis|col|row|z|top|left|right|bottom|inset|opacity|duration|ease|delay|translate|scale|rotate|cursor|select|pointer|size|space|divide|whitespace|break|aspect|object|fill|stroke|decoration|origin|animate)-|^(?:flex|grid|block|inline|hidden|contents|relative|absolute|fixed|sticky|static|shrink|grow|overflow|shadow|ring|outline|transition|truncate|sr-only|isolate|group|peer|italic|uppercase|lowercase|capitalize|antialiased|border|rounded|underline|container)$|^(?:flex|grid|block|inline|hidden|contents|relative|absolute|fixed|sticky|static|shrink|grow|overflow|shadow|ring|outline|transition|truncate|sr-only|isolate|group|peer|italic|uppercase|lowercase|capitalize|antialiased)/;

export const isUtility = (name: string) => UTILITY.test(name);

/** Ids that frameworks generate per render (React's useId, and the libraries built on it: Radix, Base UI, Headless UI, MUI), or that carry a counter. */
export const isStableId = (id: string) => !!id && !/^(?:_R_|:r|«r|radix-|base-ui-|headlessui-|mui-|react-aria)|_R_|[:«»]|\d{3,}/.test(id);

/** The classes worth naming an element by. */
export const meaningfulClasses = (element: Element) => [...element.classList].filter((name) => !isUtility(name));

/** "div.mascot-body", "button Ask the cloud": enough to know what's outlined. */
export function describe(element: Element) {
  const name = element.getAttribute("aria-label") || (element.id && isStableId(element.id) ? `#${element.id}` : "") || meaningfulClasses(element).slice(0, 2).map((c) => `.${c}`).join("");
  return `${element.tagName.toLowerCase()}${name ? (name.startsWith("#") || name.startsWith(".") ? name : ` ${name}`) : ""}`;
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

/** A selector that finds `element` alone in the document: by name if it has one, else by its place under the nearest named ancestor. */
export function selectorFor(element: Element): string {
  const only = (selector: string) => {
    try {
      const found = document.querySelectorAll(selector);
      return found.length === 1 && found[0] === element;
    } catch {
      return false;
    }
  };
  const tag = element.tagName.toLowerCase();
  if (element === document.body || element === document.documentElement) return tag;
  if (element.id && isStableId(element.id) && only(`#${CSS.escape(element.id)}`)) return `#${CSS.escape(element.id)}`;
  for (const attribute of ["data-testid", "data-test", "data-cy", "name"]) {
    const value = element.getAttribute(attribute);
    if (value && only(`${tag}[${attribute}=${quoted(value)}]`)) return `${tag}[${attribute}=${quoted(value)}]`;
  }
  const href = element instanceof HTMLAnchorElement ? element.getAttribute("href") : null;
  if (href && only(`a[href=${quoted(href)}]`)) return `a[href=${quoted(href)}]`;
  for (const name of meaningfulClasses(element)) {
    const selector = `${tag}.${CSS.escape(name)}`;
    if (only(selector)) return selector;
  }
  const parent = element.parentElement;
  if (!parent) return tag;
  const place = `${tag}:nth-child(${[...parent.children].indexOf(element) + 1})`;
  return `${selectorFor(parent)} > ${place}`;
}

const INTERACTIVE =
  "a[href], button, input, select, textarea, label, summary, [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='option'], [role='switch'], [role='checkbox'], [tabindex]:not([tabindex='-1'])";

/** Under this, both ways, an element is a part (a glyph, a stroke) rather than a thing to aim at. */
const SMALLEST = 16;

/**
 * What a point placed on `element` should follow: the nearest thing with a name of its own
 * between it and what you'd click (a link, a button), else that clickable thing, else the
 * element itself once it's big enough to be a thing. None for the page itself or a container
 * nearly as big as the window: a point there is only a place.
 */
export function anchorFor(element: Element | null): Element | null {
  if (!element || element === document.body || element === document.documentElement) return null;
  const clickable = element.closest(INTERACTIVE);
  const top = clickable ?? element.parentElement?.parentElement ?? element;
  for (let e: Element | null = element; e; e = e.parentElement) {
    const box = e.getBoundingClientRect();
    const big = box.width >= SMALLEST || box.height >= SMALLEST;
    if (big && !selectorFor(e).includes(":nth-child")) return within(e);
    if (e === top) break;
  }
  return within(clickable ?? element);
}

/** The element, unless it's nearly the whole window. */
function within(element: Element) {
  const box = element.getBoundingClientRect();
  return box.width * box.height > innerWidth * innerHeight * 0.5 ? null : element;
}
