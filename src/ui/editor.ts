/**
 * The script editor, on the stage at the size the take is filmed: click where the cursor
 * starts and where it goes, Figma's pen way (a click for a gentle arc, a drag to pull the curve's
 * handles), drag points and handles to adjust them, and say what each point does. Points are
 * tied to the element they're placed on (`selector.ts`), so they follow it if the layout moves.
 * The curves drawn are the ones the player travels (`curve` in `player.ts`). Every change can be
 * undone, and each is handed back to be saved.
 *
 * A scroll moves the page under a still cursor, so the editor shows the page as it is at the
 * point chosen: scrolled as far as the points before it scroll it (the camera pans there), a
 * scroll point after its own scroll. A point the page has scrolled past is drawn where the
 * cursor is after the scroll, its dashed line going back up to where it arrived.
 */

import type { Camera } from "../camera.ts";
import type { Point } from "../path.ts";
import { curve, estimate, type Place, resolve } from "../player.ts";
import { type Action, parseScript, type Script, SCROLL_MOST, type Step, type Target, versionOf } from "../script.ts";
import { anchorFor, describe, selectorFor } from "../selector.ts";
import { scrollerFor } from "../wheel.ts";
import { ICONS } from "./icons.ts";

export type EditorOptions = {
  root: ShadowRoot;
  /** The camera over the stage: the editor pans it to show the page as it is at the point chosen. */
  camera: Camera;
  /** How close the camera comes to clicks and typing, for how long the script plays. */
  zoom: number;
  /** The page's element at a point, Closeup's own layers left out. */
  hit: (x: number, y: number) => Element | null;
  script: Script | null;
  onChange: (script: Script | null) => void;
  onPreview: (script: Script) => void;
  onDone: () => void;
};

type Drag =
  | { kind: "node"; k: number; from: Point; moved: boolean; before: string; /** How far below where it arrived it's drawn, on screen. */ offset: number }
  | { kind: "handle"; k: number; which: "in" | "out"; before: string }
  | { kind: "pull"; k: number; from: Point; before: string };

/** How far the pointer goes before a press becomes a drag, in CSS pixels. */
const SLOP = 3;
/** What a new point does after arriving, by action: rests a little, longer after a click to show what it did. */
const NEW_STEP: Record<Action, Partial<Step>> = {
  move: { wait: 0.4 },
  click: { hover: 0.3, wait: 0.8 },
  type: { hover: 0.2, text: "", wait: 0.6 },
  scroll: { hover: 0.2, scroll: 400, wait: 0.5 },
};
const ACTIONS: { action: Action; label: string; icon: string; hint?: string }[] = [
  { action: "move", label: "Move", icon: ICONS.pointer },
  { action: "click", label: "Click", icon: ICONS.pointer_click },
  { action: "type", label: "Type", icon: ICONS.type, hint: "Type: clicks a text field, then types into it" },
  { action: "scroll", label: "Scroll", icon: ICONS.mouse, hint: "Scroll: turns the wheel here, scrolling what's under it, or the page" },
];

/** What typing can go into: a text input, a text area, or something editable. */
const TEXT_FIELD = "textarea, [contenteditable]:not([contenteditable='false']), input:not([type]), input[type='text'], input[type='search'], input[type='email'], input[type='url'], input[type='tel'], input[type='password'], input[type='number']";

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const seconds = (value: number) => (value < 10 ? value.toFixed(1) : Math.round(value).toString());
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const distance = (value: number) => (value ? `${Math.abs(Math.round(value))} ${value > 0 ? "down" : "up"}` : "None");

/** Each point's pan, in page pixels: as the cursor gets there, and once it's scrolled (the same, unless it scrolls the page). */
type Pans = { arrive: number[]; leave: number[] };

export class Editor {
  private readonly element = document.createElement("div");
  private readonly svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  private readonly labels = document.createElement("div");
  private readonly info = document.createElement("div");
  private readonly panel = document.createElement("div");
  private readonly bar = document.createElement("div");
  private readonly file = document.createElement("input");
  private script: Script | null;
  private selected: number | null = null;
  private tool: Action = "move";
  private drag: Drag | null = null;
  private aimed: Element | null = null;
  private history: string[] = [];
  private future: string[] = [];
  private message = "";
  private frame = 0;
  private pans: Pans = { arrive: [], leave: [] };
  private readonly off: () => void;

  constructor(private readonly options: EditorOptions) {
    this.script = options.script;
    this.element.className = "editor";
    this.svg.setAttribute("class", "paths");
    this.labels.className = "labels";
    this.info.className = "surface info";
    this.panel.className = "surface options point";
    this.panel.setAttribute("role", "group");
    this.panel.setAttribute("aria-label", "Point");
    this.bar.className = "surface bar";
    this.bar.setAttribute("role", "toolbar");
    this.bar.setAttribute("aria-label", "Script");
    this.file.type = "file";
    this.file.accept = ".json,application/json";
    this.file.hidden = true;
    this.element.append(this.svg, this.labels, this.info, this.panel, this.bar, this.file);
    this.bar.innerHTML = `
      <button data-edit="done" aria-label="Done" title="Done (Esc)">${ICONS.arrow_left}<span>Done</span></button>
      <div class="sep"></div>
      ${ACTIONS.map(({ action, label, icon, hint }) => `<button data-edit="tool" data-value="${action}" title="${hint ?? label}">${icon}<span>${label}</span></button>`).join("")}
      <div class="sep"></div>
      <button data-edit="undo" aria-label="Undo" title="Undo (⌘Z)">${ICONS.undo}</button>
      <button data-edit="redo" aria-label="Redo" title="Redo (⇧⌘Z)">${ICONS.redo}</button>
      <div class="sep"></div>
      <button data-edit="import" aria-label="Import a script" title="Import a script">${ICONS.upload}</button>
      <button data-edit="export" aria-label="Export the script" title="Export the script">${ICONS.download}</button>
      <button data-edit="clear" aria-label="Clear the script" title="Clear the script">${ICONS.trash}</button>
      <button class="go" data-edit="preview">${ICONS.play}<span>Preview</span></button>`;
    this.svg.addEventListener("pointerdown", this.onDown);
    this.svg.addEventListener("pointermove", this.onMove);
    this.svg.addEventListener("pointerup", this.onUp);
    this.svg.addEventListener("pointercancel", this.onUp);
    this.svg.addEventListener("dblclick", this.onDouble);
    this.svg.addEventListener("pointerleave", () => this.aim(null));
    this.element.addEventListener("click", this.onClick);
    this.panel.addEventListener("input", this.onInput);
    this.file.addEventListener("change", this.onFile);
    options.root.append(this.element);
    // Drawn again as the camera pans, so the points stay on the page.
    this.off = options.camera.onMove(() => this.schedule());
    this.render();
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.off();
    this.element.remove();
  }

  /** Hidden while a preview plays, and shown again after. */
  set hidden(hidden: boolean) {
    this.element.hidden = hidden;
    if (!hidden) this.render();
  }

  /** Keys while editing; true when the editor used it. */
  onKey(event: KeyboardEvent): boolean {
    // In a field (the text, a slider), keys are the field's own; Escape leaves it.
    const field = event.composedPath()[0];
    const inField = field instanceof HTMLInputElement;
    if (event.key === "Escape") {
      if (inField) field.blur();
      else if (this.selected !== null) this.select(null);
      else this.options.onDone();
      return true;
    }
    if (inField) return false;
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === "z") {
      if (event.shiftKey) this.redo();
      else this.undo();
      return true;
    }
    if ((event.key === "Backspace" || event.key === "Delete") && this.selected !== null) {
      this.remove(this.selected);
      return true;
    }
    const nudge = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (nudge && this.selected !== null) {
      const k = this.selected;
      const step = event.shiftKey ? 10 : 1;
      const place = this.place(k);
      this.change(() => this.setTarget(k, this.targetAt({ x: place.x + nudge[0] * step * this.scale, y: place.y + nudge[1] * step * this.scale })));
      return true;
    }
    return false;
  }

  /* ------------------------------------------------------------------ the script's points */

  private get count() {
    return this.script ? this.script.steps.length + 1 : 0;
  }

  private targetOf(k: number): Target {
    return k === 0 ? this.script!.start : this.script!.steps[k - 1].to;
  }

  private setTarget(k: number, target: Target) {
    if (k === 0) this.script!.start = target;
    else this.script!.steps[k - 1].to = target;
  }

  private outOf(k: number): Point | undefined {
    return k === 0 ? this.script!.out : this.script!.steps[k - 1].out;
  }

  private inOf(k: number): Point | undefined {
    return k === 0 ? undefined : this.script!.steps[k - 1].in;
  }

  private setHandle(k: number, which: "in" | "out", value: Point | undefined) {
    if (k === 0) {
      if (which === "out") this.script!.out = value;
      return;
    }
    const step = this.script!.steps[k - 1];
    if (value) step[which] = value;
    else delete step[which];
  }

  /** How much the page is enlarged now: handles are stored in page pixels. */
  private get scale() {
    return this.options.camera.view.scale;
  }

  /** Where point `k` arrives on screen now: on its element, as the player will find it. */
  private place(k: number): Place {
    return resolve(this.targetOf(k), this.options.camera.toScreen, this.scale);
  }

  /** How far the page scrolls under point `k` (page pixels), if it scrolls the page rather than a part of it. */
  private pans_(): Pans {
    const camera = this.options.camera;
    const arrive: number[] = [];
    const leave: number[] = [];
    let pan = 0;
    for (let k = 0; k < this.count; k++) {
      arrive.push(pan);
      const step = k > 0 ? this.script!.steps[k - 1] : null;
      if (step?.action === "scroll" && step.scroll) {
        // What the wheel turns there: a part of the page that scrolls that way, else the page.
        const at = this.place(k);
        const under = this.options.hit(at.x, at.y) ?? this.elementOf(step.to);
        if (!scrollerFor(under, step.scroll)) pan = Math.max(camera.range[0], Math.min(camera.range[1], pan + step.scroll));
      }
      leave.push(pan);
    }
    return { arrive, leave };
  }

  /** The point the page is shown at: the one chosen, else the last (where a new point goes). */
  private get showing() {
    return this.selected ?? this.count - 1;
  }

  /** How far below where it arrives point `k` is drawn, on screen: as far as it scrolled the page, once the page shown has scrolled. */
  private offsetOf(k: number) {
    return k <= this.showing ? ((this.pans.leave[k] ?? 0) - (this.pans.arrive[k] ?? 0)) * this.scale : 0;
  }

  /** Where point `k` is drawn: where it arrives, or where the cursor is after it scrolled the page. */
  private drawnAt(k: number): Place {
    const at = this.place(k);
    return { ...at, y: at.y + this.offsetOf(k) };
  }

  /** Where the cursor leaves point `k` from: below where it arrived by as far as it scrolled the page. */
  private leavesFrom(k: number): Place {
    const at = this.place(k);
    return { ...at, y: at.y + ((this.pans.leave[k] ?? 0) - (this.pans.arrive[k] ?? 0)) * this.scale };
  }

  /** Pans the camera to show the page as it is at the point chosen; never while hidden, as a preview has the camera then. */
  private follow() {
    if (this.element.hidden) return;
    this.pans = this.pans_();
    const k = this.showing;
    const pan = k >= 0 ? (this.pans.leave[k] ?? 0) : 0;
    if (Math.abs(this.options.camera.panTarget - pan) > 0.5) this.options.camera.panTo(pan);
  }

  /** A target for a point on screen: where it is in the page, and the element it's on. */
  private targetAt(q: Point): Target {
    const page = this.options.camera.toPage(q);
    const anchor = anchorFor(this.options.hit(q.x, q.y));
    if (!anchor) return { x: page.x, y: page.y };
    const box = anchor.getBoundingClientRect();
    const u = box.width ? clamp01((q.x - box.left) / box.width) : 0.5;
    const v = box.height ? clamp01((q.y - box.top) / box.height) : 0.5;
    return { x: page.x, y: page.y, on: { selector: selectorFor(anchor), u, v } };
  }

  /** The element a target follows, if it's still there. */
  private elementOf(target: Target): Element | null {
    if (!target.on) return null;
    try {
      return document.querySelector(target.on.selector);
    } catch {
      return null;
    }
  }

  /* ------------------------------------------------------------------ changes, kept for undo */

  private change(fn: () => void) {
    const before = JSON.stringify(this.script);
    fn();
    this.commit(before);
  }

  private commit(before: string) {
    if (before !== JSON.stringify(this.script)) {
      this.history.push(before);
      this.future = [];
      this.options.onChange(this.script);
    }
    this.render();
  }

  private restore(json: string) {
    this.script = parseScript(JSON.parse(json));
    if (this.selected !== null && this.selected >= this.count) this.selected = this.count ? this.count - 1 : null;
    this.options.onChange(this.script);
    this.render();
  }

  private undo() {
    const previous = this.history.pop();
    if (previous === undefined) return;
    this.future.push(JSON.stringify(this.script));
    this.restore(previous);
  }

  private redo() {
    const next = this.future.pop();
    if (next === undefined) return;
    this.history.push(JSON.stringify(this.script));
    this.restore(next);
  }

  /** Adds a point at a spot on screen, after the selected one or at the end, doing what the tool says. */
  private add(q: Point): number {
    const target = this.targetAt(q);
    if (!this.script) {
      this.script = { version: 1, start: target, steps: [] };
      return 0;
    }
    const k = this.selected === null ? this.count : this.selected + 1;
    const step: Step = { to: target, action: this.tool, wait: 0, ...NEW_STEP[this.tool] } as Step;
    this.script.steps.splice(k - 1, 0, step);
    this.script.version = versionOf(this.script.steps);
    return k;
  }

  /** Removes point `k`; without the start, the first point becomes where the cursor starts. */
  private remove(k: number) {
    this.change(() => {
      const script = this.script!;
      if (k > 0) script.steps.splice(k - 1, 1);
      else if (script.steps.length) {
        const [first, ...rest] = script.steps;
        this.script = { version: versionOf(rest), start: first.to, ...(first.out ? { out: first.out } : {}), steps: rest };
      } else this.script = null;
      if (this.script) this.script.version = versionOf(this.script.steps);
      this.selected = this.count ? Math.min(k, this.count - 1) : null;
      if (this.selected === 0 && k > 0) this.selected = k - 1;
    });
  }

  private select(k: number | null) {
    this.selected = k;
    if (k !== null && k > 0) this.tool = this.script!.steps[k - 1].action;
    this.render();
  }

  /* ------------------------------------------------------------------ pointer */

  private point = (event: PointerEvent | MouseEvent): Point => ({ x: event.clientX, y: event.clientY });

  private onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    this.svg.setPointerCapture(event.pointerId);
    const target = event.target as Element;
    const before = JSON.stringify(this.script);
    const handle = target.closest<SVGElement>("[data-handle]");
    const node = target.closest<SVGElement>("[data-node]");
    if (handle) {
      this.drag = { kind: "handle", k: Number(handle.dataset.node), which: handle.dataset.handle as "in" | "out", before };
    } else if (node) {
      const k = Number(node.dataset.node);
      this.select(k);
      this.drag = { kind: "node", k, from: this.point(event), moved: false, before, offset: this.offsetOf(k) };
    } else {
      const k = this.add(this.point(event));
      this.selected = k;
      this.drag = { kind: "pull", k, from: this.point(event), before };
      this.render();
    }
  };

  private onMove = (event: PointerEvent) => {
    const p = this.point(event);
    const drag = this.drag;
    if (!drag) return this.aim(anchorFor(this.options.hit(p.x, p.y)));
    const scale = this.scale;
    if (drag.kind === "node") {
      if (!drag.moved && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) < SLOP) return;
      drag.moved = true;
      // Follows the pointer exactly while dragged; tied to what's under it on letting go.
      const page = this.options.camera.toPage({ x: p.x, y: p.y - drag.offset });
      this.setTarget(drag.k, { x: page.x, y: page.y });
    } else {
      // A handle leaving a point that scrolled the page is drawn from where the cursor is after the scroll.
      const at = drag.kind === "handle" && drag.which === "out" ? this.leavesFrom(drag.k) : this.place(drag.k);
      if (drag.kind === "pull" && Math.hypot(p.x - drag.from.x, p.y - drag.from.y) < SLOP) return;
      const handle = { x: (p.x - at.x) / scale, y: (p.y - at.y) / scale };
      const mirror = { x: -handle.x, y: -handle.y };
      if (drag.kind === "pull" || drag.which === "out") {
        this.setHandle(drag.k, "out", handle);
        if (drag.kind === "pull" || !event.altKey) this.setHandle(drag.k, "in", drag.k > 0 ? mirror : undefined);
      } else {
        this.setHandle(drag.k, "in", handle);
        if (!event.altKey && this.outOf(drag.k)) this.setHandle(drag.k, "out", mirror);
      }
    }
    this.schedule();
  };

  private onUp = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;
    if (drag.kind === "node" && drag.moved) {
      const p = this.point(event);
      this.setTarget(drag.k, this.targetAt({ x: p.x, y: p.y - drag.offset }));
    }
    this.commit(drag.before);
  };

  /** A double click on a point turns its curve from handles to a gentle arc, or from an arc to smooth handles. */
  private onDouble = (event: MouseEvent) => {
    const node = (event.target as Element).closest<SVGElement>("[data-node]");
    if (!node) return;
    const k = Number(node.dataset.node);
    this.change(() => {
      if (this.inOf(k) || this.outOf(k)) {
        this.setHandle(k, "in", undefined);
        this.setHandle(k, "out", undefined);
        return;
      }
      // Smooth: handles along the line from the point before to the point after.
      const before = this.place(Math.max(0, k - 1));
      const after = this.place(Math.min(this.count - 1, k + 1));
      const scale = this.scale;
      const h = { x: (after.x - before.x) / 6 / scale, y: (after.y - before.y) / 6 / scale };
      if (k > 0) this.setHandle(k, "in", { x: -h.x, y: -h.y });
      if (k < this.count - 1) this.setHandle(k, "out", h);
    });
  };

  /** Outlines what a point placed here would follow. */
  private aim(element: Element | null) {
    if (element === this.aimed) return;
    this.aimed = element;
    this.schedule();
  }

  /** Redraws the curves and the summary on the next frame; the point's panel stays as it is, so its field keeps focus. */
  private schedule() {
    cancelAnimationFrame(this.frame);
    if (this.element.hidden) return;
    this.frame = requestAnimationFrame(() => {
      this.follow();
      this.renderPaths();
      this.renderInfo();
    });
  }

  /* ------------------------------------------------------------------ controls */

  private onClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-edit]");
    if (!button) return;
    const { edit, value } = button.dataset;
    switch (edit) {
      case "done":
        return this.options.onDone();
      case "tool": {
        this.tool = value as Action;
        const k = this.selected;
        if (k !== null && k > 0) {
          this.change(() => {
            const step = this.script!.steps[k - 1];
            if (step.action === this.tool) return;
            step.action = this.tool;
            delete step.hover;
            delete step.text;
            delete step.scroll;
            Object.assign(step, { ...NEW_STEP[this.tool], wait: step.wait });
            this.script!.version = versionOf(this.script!.steps);
          });
        } else this.render();
        return;
      }
      case "undo":
        return this.undo();
      case "redo":
        return this.redo();
      case "import":
        return this.file.click();
      case "export":
        return this.export();
      case "clear":
        return this.change(() => {
          this.script = null;
          this.selected = null;
        });
      case "preview":
        if (this.script?.steps.length) this.options.onPreview(this.script);
        return;
      case "delete":
        if (this.selected !== null) this.remove(this.selected);
        return;
      case "curve": {
        const k = this.selected;
        if (k === null || k === 0) return;
        // The curve arriving at the point: a gentle arc (no handles), or a straight line (handles at the points).
        return this.change(() => {
          const straight = value === "straight" ? { x: 0, y: 0 } : undefined;
          this.setHandle(k, "in", straight);
          this.setHandle(k - 1, "out", straight);
        });
      }
    }
  };

  /** Sliders and the text field change the selected point as they move; the change is kept once. */
  private pending: string | null = null;

  private onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const k = this.selected;
    if (k === null || k === 0 || !input.dataset.field) return;
    this.pending ??= JSON.stringify(this.script);
    const step = this.script!.steps[k - 1];
    const field = input.dataset.field as "text" | "hover" | "wait" | "duration" | "scroll";
    if (field === "text") step.text = input.value;
    else {
      const value = Number(input.value);
      if (field === "duration" && value === 0) delete step.duration;
      else step[field] = value;
      const output = this.panel.querySelector(`output[data-for="${field}"]`);
      if (output) output.textContent = field === "scroll" ? distance(value) : field === "duration" && value === 0 ? "Auto" : `${seconds(value)} s`;
    }
    this.options.onChange(this.script);
    this.follow();
    this.renderPaths();
    this.renderInfo();
    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => {
      if (this.pending !== null) {
        this.history.push(this.pending);
        this.future = [];
        this.pending = null;
      }
    }, 400);
  };

  private settle = 0;

  private onFile = async () => {
    const file = this.file.files?.[0];
    this.file.value = "";
    if (!file) return;
    try {
      const script = parseScript(JSON.parse(await file.text()));
      if (!script) throw new Error();
      this.change(() => {
        this.script = script;
        this.selected = null;
      });
      this.message = "";
    } catch {
      this.message = "That file isn't a Closeup script.";
      this.render();
    }
  };

  private export() {
    if (!this.script) return;
    const blob = new Blob([JSON.stringify(this.script, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const page = location.pathname.replace(/^\/|\/$/g, "").replace(/\//g, "-") || "home";
    link.download = `closeup-${page}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  /* ------------------------------------------------------------------ drawing */

  private render() {
    this.follow();
    this.renderPaths();
    this.renderInfo();
    this.renderPanel();
    this.renderBar();
  }

  private renderPaths() {
    const scale = this.scale;
    const drawn = Array.from({ length: this.count }, (_, k) => this.drawnAt(k));
    const parts: string[] = [];
    if (this.aimed && !this.drag) {
      const box = this.aimed.getBoundingClientRect();
      parts.push(`<rect class="aim" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" rx="3"/>`);
    }
    for (let k = 1; k < drawn.length; k++) {
      const [a, b] = curve(this.leavesFrom(k - 1), this.place(k), this.outOf(k - 1), this.inOf(k), scale);
      const c1 = { x: a.at.x + a.out!.x, y: a.at.y + a.out!.y };
      const c2 = { x: b.at.x + b.in!.x, y: b.at.y + b.in!.y };
      parts.push(`<path class="segment" d="M${a.at.x} ${a.at.y}C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${b.at.x} ${b.at.y}"/>`);
    }
    // A point that scrolled the page: dashed from where it arrived to where the cursor is after.
    for (let k = 1; k < drawn.length; k++) {
      const from = this.place(k);
      const to = this.leavesFrom(k);
      if (Math.abs(to.y - from.y) > 0.5) parts.push(`<line class="scrolled" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`);
    }
    const k = this.selected;
    if (k !== null && k < drawn.length) {
      for (const which of ["in", "out"] as const) {
        const handle = which === "in" ? this.inOf(k) : this.outOf(k);
        if (!handle || (!handle.x && !handle.y)) continue;
        const at = which === "in" ? this.place(k) : this.leavesFrom(k);
        const h = { x: at.x + handle.x * scale, y: at.y + handle.y * scale };
        parts.push(`<line class="handle-line" x1="${at.x}" y1="${at.y}" x2="${h.x}" y2="${h.y}"/>`);
        parts.push(`<circle class="handle" data-node="${k}" data-handle="${which}" cx="${h.x}" cy="${h.y}" r="4.5"/>`);
      }
    }
    drawn.forEach((at, n) => {
      const classes = ["node", n === 0 ? "start" : "", n === this.selected ? "selected" : ""].filter(Boolean).join(" ");
      parts.push(`<g class="${classes}" data-node="${n}"><circle cx="${at.x}" cy="${at.y}" r="${n === 0 ? 7 : 6}"/>${n === 0 ? `<circle class="dot" cx="${at.x}" cy="${at.y}" r="2.5"/>` : ""}</g>`);
    });
    this.svg.innerHTML = parts.join("");
    this.labels.innerHTML = drawn
      .map((at, n) => {
        const step = n > 0 ? this.script!.steps[n - 1] : null;
        const detail = step?.action === "type" && step.text ? ` “${escapeHtml(step.text.slice(0, 18))}${step.text.length > 18 ? "…" : ""}”` : step?.action === "scroll" ? ` ${step.scroll ? `${Math.abs(Math.round(step.scroll))} px ${step.scroll > 0 ? "down" : "up"}` : ""}` : "";
        const what = !step ? "Start" : `${n} · ${ACTIONS.find((a) => a.action === step.action)!.label}${detail}`;
        return `<div class="node-label${n === this.selected ? " selected" : ""}" style="translate:${Math.round(at.x + 10)}px ${Math.round(at.y - 30)}px">${what}</div>`;
      })
      .join("");
  }

  private renderInfo() {
    if (this.selected !== null) {
      this.info.hidden = true;
      return;
    }
    this.info.hidden = false;
    const keys = `<span class="keys"><kbd>⌫</kbd> deletes · <kbd>Esc</kbd> done</span>`;
    let text: string;
    if (this.message) text = `<span class="warn">${escapeHtml(this.message)}</span>`;
    else if (!this.script) text = `<span class="what">Click where the cursor starts</span>`;
    else if (!this.script.steps.length) text = `<span class="what">Click where it goes · drag to curve</span>`;
    else {
      const pans = this.pans;
      const total = estimate(this.script, (target) => resolve(target, this.options.camera.toScreen, this.scale), this.scale, this.options.zoom, (k) => ((pans.leave[k] ?? 0) - (pans.arrive[k] ?? 0)) * this.scale);
      const moves = this.script.steps.length;
      text = `<span class="size">${moves} ${moves === 1 ? "move" : "moves"} · about ${seconds(total)} s</span><span class="what">Click to add · drag to curve</span>${keys}`;
    }
    this.info.innerHTML = text;
  }

  private renderPanel() {
    const k = this.selected;
    if (k === null || !this.script) {
      this.panel.hidden = true;
      return;
    }
    this.panel.hidden = false;
    const target = this.targetOf(k);
    const element = this.elementOf(target);
    const on = element ? escapeHtml(describe(element).slice(0, 40)) : "a place on the page";
    const row = (name: string, body: string) => `<div class="row"><span class="name">${name}</span>${body}</div>`;
    const slider = (field: string, label: string, max: number, step: number, value: number, show: string) =>
      `<div class="slider"><input type="range" min="0" max="${max}" step="${step}" value="${value}" data-field="${field}" aria-label="${label}"><output data-for="${field}">${show}</output></div>`;
    const head = `<div class="row"><span class="name">${k === 0 ? "Start" : `Point ${k}`}</span><div class="choices spread"><span class="what" title="${on}">On ${on}</span><button data-edit="delete" aria-label="Delete this point" title="Delete (⌫)">${ICONS.trash}</button></div></div>`;
    if (k === 0) {
      this.panel.innerHTML = `${head}<p class="hint">Where the cursor is when the take begins.</p>`;
      return;
    }
    const step = this.script.steps[k - 1];
    const scrollsPage = (this.pans.leave[k] ?? 0) !== (this.pans.arrive[k] ?? 0);
    const custom = !!(step.in && (step.in.x || step.in.y)) || !!(this.outOf(k - 1) && (this.outOf(k - 1)!.x || this.outOf(k - 1)!.y));
    const straight = !!step.in && !step.in.x && !step.in.y;
    // Typing goes into what the click focused: say so when there's no field under the point.
    const place = this.place(k);
    const field = step.action === "type" && !!this.options.hit(place.x, place.y)?.closest(TEXT_FIELD);
    this.panel.innerHTML = [
      head,
      step.action === "type" ? row("Text", `<input class="text" type="text" value="${escapeHtml(step.text ?? "")}" data-field="text" aria-label="Text to type" placeholder="What to type">`) : "",
      step.action === "type" && !field ? `<p class="hint warn">Typing goes into the text field this point clicks: there's none under it. Put it on a field (a search box, a form) to see the text written.</p>` : "",
      step.action === "scroll"
        ? row("Distance", `<div class="slider wide"><input type="range" min="${-Math.min(SCROLL_MOST, 3000)}" max="${Math.min(SCROLL_MOST, 3000)}" step="10" value="${step.scroll ?? 0}" data-field="scroll" aria-label="How far it scrolls, down or up"><output data-for="scroll">${distance(step.scroll ?? 0)}</output></div>`)
        : "",
      step.action === "scroll" ? `<p class="hint">${scrollsPage ? "Scrolls the page: the next point is placed on what it shows." : "Scrolls the part of the page under it."}</p>` : "",
      step.action !== "move" ? row("Hover", slider("hover", "Hover before acting", 3, 0.1, step.hover ?? 0, `${seconds(step.hover ?? 0)} s`)) : "",
      row("Rest", slider("wait", "Rest after", 5, 0.1, step.wait, `${seconds(step.wait)} s`)),
      row("Pace", slider("duration", "Seconds the move takes, or Auto", 3, 0.05, step.duration ?? 0, step.duration ? `${seconds(step.duration)} s` : "Auto")),
      row(
        "Curve",
        `<div class="choices"><button data-edit="curve" data-value="arc" aria-pressed="${!custom && !straight}">Arc</button><button data-edit="curve" data-value="straight" aria-pressed="${straight}">Straight</button>${custom && !straight ? `<span class="note">Drawn</span>` : ""}</div>`,
      ),
    ].join("");
  }

  private renderBar() {
    const k = this.selected;
    const action = k !== null && k > 0 ? this.script!.steps[k - 1].action : this.tool;
    // With the start selected (it does nothing), the tools say what the next point will do.
    for (const button of this.bar.querySelectorAll<HTMLButtonElement>("[data-edit='tool']")) button.setAttribute("aria-pressed", String(button.dataset.value === action));
    this.bar.querySelector<HTMLButtonElement>("[data-edit='undo']")!.disabled = !this.history.length;
    this.bar.querySelector<HTMLButtonElement>("[data-edit='redo']")!.disabled = !this.future.length;
    this.bar.querySelector<HTMLButtonElement>("[data-edit='export']")!.disabled = !this.script;
    this.bar.querySelector<HTMLButtonElement>("[data-edit='clear']")!.disabled = !this.script;
    this.bar.querySelector<HTMLButtonElement>("[data-edit='preview']")!.disabled = !this.script?.steps.length;
  }
}
