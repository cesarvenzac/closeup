/**
 * Hover and press, for a cursor that isn't real. A page's script can be told the pointer moved
 * (`pointer.ts` sends the events), but CSS's :hover and :active follow only the real pointer, and
 * no page can set them. So every rule that uses them is copied once, each :hover and :active
 * swapped for an attribute Closeup puts on the elements under the drawn cursor, and the copies
 * added in a stylesheet of their own, in the same cascade layers and media queries as the rules
 * they copy. Rules in another site's stylesheets can't be read, so they can't be copied.
 */

export const HOVER = "data-closeup-hover";
export const ACTIVE = "data-closeup-active";

const HOVER_RE = /:hover(?![\w-])/g;
const ACTIVE_RE = /:active(?![\w-])/g;
const USES = /:(?:hover|active)(?![\w-])/;

/** A selector with :hover and :active swapped for Closeup's attributes. Same specificity: a pseudo-class and an attribute weigh alike. */
export const markSelector = (selector: string) => selector.replace(HOVER_RE, `[${HOVER}]`).replace(ACTIVE_RE, `[${ACTIVE}]`);

/** A media query only about whether the device can hover: always true for the drawn cursor, which does. */
const onlyHover = (condition: string) => /^\(\s*hover\s*:\s*hover\s*\)$/.test(condition.trim());

/**
 * The part of `rule` that hovering or pressing changes, rewritten for the attributes; "" when
 * there's none. A rule whose own selector hovers is copied whole (its nested rules apply only
 * while hovered); one that doesn't keeps only its nested rules that do; grouping rules (layers,
 * media, supports, containers) wrap what's kept inside them.
 */
export function copyRule(rule: CSSRule): string {
  if (rule instanceof CSSStyleRule) {
    const nested = [...rule.cssRules];
    if (USES.test(rule.selectorText)) {
      return `${markSelector(rule.selectorText)}{${rule.style.cssText}${nested.map(copyAll).join("")}}`;
    }
    const inner = nested.map(copyRule).join("");
    return inner ? `${rule.selectorText}{${inner}}` : "";
  }
  if (rule instanceof CSSMediaRule) {
    const inner = [...rule.cssRules].map(copyRule).join("");
    if (!inner) return "";
    return onlyHover(rule.conditionText) ? inner : `@media ${rule.conditionText}{${inner}}`;
  }
  if (rule instanceof CSSLayerBlockRule) {
    const inner = [...rule.cssRules].map(copyRule).join("");
    return inner ? `@layer ${rule.name}{${inner}}` : "";
  }
  if (rule instanceof CSSSupportsRule || (typeof CSSContainerRule !== "undefined" && rule instanceof CSSContainerRule)) {
    const inner = [...(rule as CSSGroupingRule).cssRules].map(copyRule).join("");
    const at = rule instanceof CSSSupportsRule ? "@supports" : "@container";
    return inner ? `${at} ${(rule as CSSConditionRule).conditionText}{${inner}}` : "";
  }
  if (rule instanceof CSSImportRule && rule.styleSheet) {
    const inner = rulesOf(rule.styleSheet).map(copyRule).join("");
    if (!inner) return "";
    const layered = rule.layerName !== null ? `@layer ${rule.layerName}{${inner}}` : inner;
    return rule.media.mediaText ? `@media ${rule.media.mediaText}{${layered}}` : layered;
  }
  return "";
}

/** A nested rule under a hovered one: all of it, its own :hover and :active swapped too. */
function copyAll(rule: CSSRule): string {
  if (rule instanceof CSSStyleRule) return `${markSelector(rule.selectorText)}{${rule.style.cssText}${[...rule.cssRules].map(copyAll).join("")}}`;
  if (rule instanceof CSSGroupingRule) return copyRule(rule) || rule.cssText;
  return rule.cssText;
}

/** A stylesheet's rules, or none if it's another site's (reading them throws). */
function rulesOf(sheet: CSSStyleSheet): CSSRule[] {
  try {
    return [...sheet.cssRules];
  } catch {
    return [];
  }
}

/** Copies the page's hover and press rules for the drawn cursor. `remove()` takes them away again. */
export function emulateHover() {
  const style = document.createElement("style");
  style.dataset.closeup = "";
  style.textContent = [...document.styleSheets].flatMap(rulesOf).map(copyRule).join("\n");
  document.head.append(style);
  return {
    remove() {
      style.remove();
      for (const element of document.querySelectorAll(`[${HOVER}], [${ACTIVE}]`)) {
        element.removeAttribute(HOVER);
        element.removeAttribute(ACTIVE);
      }
    },
  };
}
