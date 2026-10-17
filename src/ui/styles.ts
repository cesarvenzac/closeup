/**
 * The toolbar's look, inside its own shadow root so no page's styles reach it: dark glass like
 * macOS's own screenshot toolbar, the system's font, quiet controls. Entrances ease out, exits
 * are quicker, and nothing moves under reduced motion.
 */
export const STYLES = /* css */ `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.surface {
  pointer-events: auto;
  --ink: #f5f5f7;
  --muted: rgb(245 245 247 / 0.62);
  --faint: rgb(245 245 247 / 0.38);
  --line: rgb(255 255 255 / 0.12);
  --hover: rgb(255 255 255 / 0.08);
  --on: rgb(255 255 255 / 0.16);
  --accent: #0a84ff;
  --record: #ff453a;
  position: fixed;
  z-index: 2147483647;
  color: var(--ink);
  font: 13px/1.2 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif;
  letter-spacing: -0.005em;
  background: rgb(30 30 32 / 0.84);
  backdrop-filter: blur(22px) saturate(1.5);
  -webkit-backdrop-filter: blur(22px) saturate(1.5);
  border: 0.5px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 12px 32px rgb(0 0 0 / 0.32), 0 2px 6px rgb(0 0 0 / 0.18);
  cursor: default;
  -webkit-font-smoothing: antialiased;
  transition: opacity 180ms ease-out, translate 220ms cubic-bezier(0.22, 1, 0.36, 1), scale 220ms cubic-bezier(0.22, 1, 0.36, 1);
}
.surface[data-leaving] { opacity: 0; translate: 0 6px; scale: 0.98; transition-duration: 120ms; }
@starting-style { .surface { opacity: 0; translate: 0 8px; scale: 0.98; } }

button {
  all: unset;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 30px;
  min-width: 30px;
  padding: 0 8px;
  border-radius: 8px;
  color: var(--ink);
  white-space: nowrap;
  cursor: default;
  transition: background-color 120ms ease-out, color 120ms ease-out, scale 120ms ease-out;
}
button:hover { background: var(--hover); }
button:active { scale: 0.96; }
button[aria-pressed="true"] { background: var(--on); }
button:disabled { color: var(--faint); background: none; scale: 1; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
input.text:focus-visible { outline-offset: 0; }
button svg { display: block; flex: none; }

/* The toolbar */
.bar { left: 50%; bottom: 22px; translate: -50% 0; display: flex; align-items: center; gap: 2px; padding: 5px; }
.bar[data-leaving] { translate: -50% 6px; }
@starting-style { .bar { translate: -50% 8px; } }
.sep { width: 1px; height: 18px; margin: 0 4px; background: var(--line); }
.go { margin-left: 4px; padding: 0 12px; background: var(--ink); color: #111; font-weight: 500; }
.go:hover { background: #fff; }
.go:disabled { background: rgb(255 255 255 / 0.14); color: var(--faint); }
.label { color: var(--muted); }
.chevron { color: var(--faint); }

/* What's picked, and what it will make */
.info {
  left: 50%; bottom: 72px; translate: -50% 0;
  display: flex; align-items: center; gap: 10px; padding: 7px 11px; border-radius: 10px;
  white-space: nowrap; max-width: calc(100vw - 32px);
}
@starting-style { .info { translate: -50% 6px; } }
.info .what { color: var(--muted); overflow: hidden; text-overflow: ellipsis; max-width: 260px; }
.info .size { font-variant-numeric: tabular-nums; }
.info .warn { color: #ffd60a; }
.info .keys { color: var(--faint); }
kbd { font: inherit; padding: 1px 5px; border-radius: 4px; background: rgb(255 255 255 / 0.1); color: var(--muted); }

/* The pick on the page */
.outline {
  position: fixed; z-index: 2147483645; pointer-events: none; border-radius: 3px;
  border: 1.5px solid var(--accent, #0a84ff); background: rgb(10 132 255 / 0.08);
  transition: left 70ms ease-out, top 70ms ease-out, width 70ms ease-out, height 70ms ease-out;
}
.outline[data-picked] { box-shadow: 0 0 0 100vmax rgb(12 12 14 / 0.28); background: none; }
.tag {
  position: absolute; left: -1.5px; bottom: calc(100% + 6px); padding: 3px 6px; border-radius: 5px;
  background: #0a84ff; color: white; font: 500 11px/1.2 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis;
}
.catcher { position: fixed; inset: 0; z-index: 2147483644; cursor: crosshair; pointer-events: auto; }

/* Options */
.options {
  left: 50%; bottom: 72px; translate: -50% 0; width: 360px; max-height: calc(100vh - 110px); overflow: auto;
  padding: 8px 10px 10px; display: grid; gap: 2px;
  transform-origin: bottom center;
}
@starting-style { .options { translate: -50% 6px; scale: 0.98; } }
.row { display: grid; grid-template-columns: 84px 1fr; align-items: center; gap: 8px; min-height: 36px; }
.row > .name { color: var(--muted); }
.row.sub > .name { color: var(--faint); padding-left: 10px; }
.choices { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.choices button { height: 26px; padding: 0 7px; }
.switch { justify-self: start; }
.switch[aria-checked="true"] { background: var(--on); }
input[type="range"] { width: 100%; accent-color: var(--ink); }
.slider { display: grid; grid-template-columns: 1fr 42px; align-items: center; gap: 8px; }
.slider output { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
.swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.swatch { width: 26px; height: 26px; min-width: 0; padding: 0; border-radius: 999px; box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.18); }
.swatch[aria-pressed="true"] { box-shadow: 0 0 0 2px rgb(30 30 32), 0 0 0 4px var(--ink); background-clip: padding-box; }
input[type="color"] { width: 30px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: none; }
.note { color: var(--faint); }
.hint.warn { color: #ffd60a; border-top: 0; margin-top: 0; padding-top: 2px; line-height: 1.35; }
.hint { color: var(--faint); padding: 8px 2px 0; border-top: 1px solid var(--line); margin-top: 6px; }

/* While recording: above the frame, outside what's filmed, with a shadow too short to reach it */
.hud { left: 50%; translate: -50% 0; display: flex; align-items: center; gap: 8px; padding: 5px 5px 5px 12px; border-radius: 999px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.24); }
@starting-style { .hud { translate: -50% -6px; } }
.dot { width: 8px; height: 8px; border-radius: 999px; background: var(--record); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.45; } }
.time { font-variant-numeric: tabular-nums; min-width: 34px; }
.stop { border-radius: 999px; background: rgb(255 255 255 / 0.12); padding: 0 10px; }

/* The result */
.backdrop { pointer-events: auto; position: fixed; inset: 0; z-index: 2147483646; background: rgb(12 12 14 / 0.55); backdrop-filter: blur(6px); transition: opacity 180ms ease-out; }
@starting-style { .backdrop { opacity: 0; } }
.sheet {
  left: 50%; top: 50%; translate: -50% -50%; width: min(880px, calc(100vw - 48px));
  padding: 10px; display: grid; gap: 10px;
}
@starting-style { .sheet { translate: -50% calc(-50% + 10px); scale: 0.98; } }
.media { display: grid; place-items: center; border-radius: 9px; overflow: hidden; background: rgb(0 0 0 / 0.35); max-height: calc(100vh - 160px); }
.media video, .media img { display: block; max-width: 100%; max-height: calc(100vh - 160px); }
.footer { display: flex; align-items: center; gap: 4px; padding: 0 2px 0 4px; }
.footer .meta { color: var(--muted); font-variant-numeric: tabular-nums; margin-right: auto; }
/* A page's own action counts its progress up in the same width. */
.footer [data-action="take-action"] span { font-variant-numeric: tabular-nums; }
.toast { left: 50%; top: 22px; translate: -50% 0; padding: 9px 13px; border-radius: 10px; max-width: calc(100vw - 32px); }

/* The script editor: Figma's pen, over the staged page */
.paths { position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 2147483645; pointer-events: auto; cursor: crosshair; overflow: visible; }
.paths .segment { fill: none; stroke: #0a84ff; stroke-width: 1.5; }
.paths .node { cursor: move; }
.paths .node circle { fill: #fff; stroke: #0a84ff; stroke-width: 1.5; }
.paths .node.selected circle { fill: #0a84ff; }
.paths .node.start circle { stroke-width: 2; }
.paths .node .dot { fill: #0a84ff; stroke: none; }
.paths .node.selected .dot { fill: #fff; }
.paths .handle-line { stroke: #0a84ff; stroke-width: 1; }
.paths .handle { fill: #fff; stroke: #0a84ff; stroke-width: 1.5; cursor: grab; }
.paths .aim { fill: rgb(10 132 255 / 0.06); stroke: rgb(10 132 255 / 0.7); stroke-width: 1; stroke-dasharray: 3 3; pointer-events: none; }
.labels { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
.node-label {
  position: absolute; left: 0; top: 0; padding: 2px 6px; border-radius: 5px;
  background: rgb(30 30 32 / 0.84); color: #f5f5f7; font: 500 11px/1.3 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; white-space: nowrap;
}
.node-label.selected { background: #0a84ff; color: #fff; }
/* A point's settings sit in the corner, clear of what's being filmed in the middle. */
.options.point { left: auto; right: 16px; translate: none; width: 320px; }
@starting-style { .options.point { translate: 0 6px; } }
.point .spread { flex-wrap: nowrap; justify-content: space-between; align-items: center; gap: 8px; min-width: 0; }
.point .what { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
input.text {
  box-sizing: border-box; width: 100%; height: 28px; padding: 0 8px; border-radius: 7px;
  font: inherit; color: var(--ink); background: rgb(255 255 255 / 0.08); border: 0.5px solid var(--line);
}
input.text::placeholder { color: var(--faint); }

@media (prefers-reduced-motion: reduce) {
  .surface, .backdrop, button, .outline { transition: none; }
  .dot { animation: none; }
}
`;
