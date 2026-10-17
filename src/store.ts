/** Each page's script, kept in the browser by its path, so the scene is there the next time. */

import { parseScript, type Script } from "./script.ts";

const keyOf = (path: string) => `closeup:script:${path}`;

export function loadScript(path = location.pathname): Script | null {
  try {
    return parseScript(JSON.parse(localStorage.getItem(keyOf(path)) ?? "null"));
  } catch {
    return null;
  }
}

export function saveScript(script: Script | null, path = location.pathname) {
  try {
    if (script) localStorage.setItem(keyOf(path), JSON.stringify(script));
    else localStorage.removeItem(keyOf(path));
  } catch {
    // Private windows and blocked storage: the script lasts as long as the page.
  }
}
