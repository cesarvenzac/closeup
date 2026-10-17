/**
 * The toolbar and everything round it: pick what to film (an element, or a region drawn by
 * hand), choose photo or video and the options, film it, and look at the result before
 * keeping it. One instance, mounted outside the page's <body> (stage mode moves <body>), its
 * controls in a shadow root no page's styles reach.
 */

import { actionsFor, type TakeAction } from "../actions.ts";
import { supportsCapture } from "../capture.ts";
import { fillFor, pixelSize, type Rect, SHAPES, type Shape, type Stage, stageFor, toScreen } from "../frame.ts";
import { play } from "../player.ts";
import { Mixer } from "../sounds.ts";
import { enterStage } from "../stage.ts";
import { GRADIENTS, loadSettings, saveSettings, type Settings } from "../settings.ts";
import type { Script } from "../script.ts";
import { describe } from "../selector.ts";
import { loadScript, saveScript } from "../store.ts";
import { createActor, frameBox, frameOf, type Layers, pageHit, type Picked, type Result, type Running, startVideo, takePhoto, toRect } from "../take.ts";
import { Editor } from "./editor.ts";
import { ICONS, svg } from "./icons.ts";
import { STYLES } from "./styles.ts";

type State = "idle" | "picking" | "picked" | "busy" | "recording" | "preview" | "editing" | "rehearsing";
type Pick = Picked & { label: string; /** A region's rectangle in the document, so it follows scrolling. */ page?: Rect };

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Smaller than this both ways, in CSS pixels, an element is a part (a glyph, a stroke) rather than a thing. */
const SMALLEST = 48;
const isSmall = (element: Element) => {
  const { width, height } = element.getBoundingClientRect();
  return width < SMALLEST && height < SMALLEST;
};

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");

export class Panel {
  private readonly ui = document.createElement("div");
  private readonly layer = document.createElement("div");
  private readonly shadow: ShadowRoot;
  private readonly $: <T extends HTMLElement = HTMLElement>(selector: string) => T;
  private settings: Settings = loadSettings();
  private image: ImageBitmap | null = null;
  private imageName = "";
  private state: State = "idle";
  private picked: Pick | null = null;
  private hovered: Element | null = null;
  private trail: Element[] = [];
  private dragFrom: { x: number; y: number } | null = null;
  private running: Running | null = null;
  private result: Result | null = null;
  private resultUrl = "";
  /** The actions offered on the take on show, in the order their buttons are drawn. */
  private takeActions: TakeAction[] = [];
  private timer = 0;
  private follow = 0;
  private mounted = false;
  private optionsOpen = false;
  /** While a script is edited: the editor, the stage it's on, and what puts the page back. */
  private editing: { editor: Editor; stage: Stage; box: HTMLElement; leave: () => Promise<void> } | null = null;
  private rehearsal: AbortController | null = null;

  constructor(private readonly shortcutLabel: string) {
    this.shadow = this.ui.attachShadow({ mode: "open" });
    this.$ = <T extends HTMLElement>(selector: string) => this.shadow.querySelector(selector) as T;
    const fixed = "position:fixed;inset:0;pointer-events:none;";
    this.ui.setAttribute("style", `${fixed}z-index:2147483647;`);
    this.ui.setAttribute("data-closeup", "");
    this.layer.setAttribute("style", `${fixed}z-index:2147483640;`);
    this.layer.setAttribute("data-closeup", "");
    this.shadow.innerHTML = `
      <style>${STYLES}</style>
      <div class="outline" hidden><div class="tag"></div></div>
      <div class="catcher" hidden></div>
      <div class="surface info" hidden></div>
      <div class="surface options" hidden role="group" aria-label="Options"></div>
      <div class="surface bar" role="toolbar" aria-label="Closeup" hidden>
        <button data-action="close" aria-label="Close" title="Close (Esc)">${ICONS.x}</button>
        <div class="sep"></div>
        <button data-action="pick" data-value="element" aria-label="Pick an element" title="Pick an element">${ICONS.crosshair}</button>
        <button data-action="pick" data-value="region" aria-label="Draw a region" title="Draw a region">${ICONS.square_dashed}</button>
        <div class="sep"></div>
        <button data-action="mode" data-value="photo" aria-label="Photo" title="Photo">${ICONS.camera}</button>
        <button data-action="mode" data-value="video" aria-label="Video" title="Video">${ICONS.video}</button>
        <button data-action="script" aria-label="Script the cursor" title="Script the cursor">${ICONS.spline}</button>
        <div class="sep"></div>
        <button data-action="options" aria-expanded="false"><span>Options</span><span class="chevron">${ICONS.chevron_down}</span></button>
        <button class="go" data-action="go" disabled>Record</button>
      </div>
      <div class="surface hud" hidden><span class="dot" aria-hidden="true"></span><span class="time">0:00</span><button class="stop" data-action="stop">${ICONS.square}Stop</button></div>
      <div class="backdrop" hidden data-action="retake"></div>
      <div class="surface sheet" hidden role="dialog" aria-label="Your take"></div>
      <div class="surface toast" hidden role="status"></div>`;
    this.shadow.addEventListener("click", this.onClick);
    this.shadow.addEventListener("input", this.onInput);
    this.$(".catcher").addEventListener("pointerdown", this.onDragStart);
  }

  get isOpen() {
    return this.mounted;
  }

  open() {
    if (!this.mounted) {
      document.documentElement.append(this.layer, this.ui);
      this.mounted = true;
      addEventListener("keydown", this.onKey, true);
      addEventListener("scroll", this.track, true);
      addEventListener("resize", this.track);
    }
    if (!supportsCapture()) {
      this.toast("Closeup films with Chrome's Region Capture: open this page in Chrome, Edge, Arc or Brave.");
      return;
    }
    this.$(".bar").hidden = false;
    this.renderBar();
    if (!this.picked) this.startPick();
    else this.showPicked();
  }

  close() {
    if (this.state === "recording" || this.state === "busy" || this.state === "rehearsing") return;
    if (this.state === "editing") {
      void this.doneEditing().then(() => this.close());
      return;
    }
    this.stopPick();
    this.closePreview();
    this.picked = null;
    this.optionsOpen = false;
    removeEventListener("keydown", this.onKey, true);
    removeEventListener("scroll", this.track, true);
    removeEventListener("resize", this.track);
    cancelAnimationFrame(this.follow);
    this.ui.remove();
    this.layer.remove();
    this.mounted = false;
    this.state = "idle";
    for (const selector of [".bar", ".info", ".options", ".outline", ".hud", ".toast"]) this.$(selector).hidden = true;
  }

  toggle() {
    if (this.mounted) this.close();
    else this.open();
  }

  /* ------------------------------------------------------------------ picking */

  private startPick() {
    this.stopPick();
    this.state = "picking";
    this.picked = null;
    this.hovered = null;
    this.trail = [];
    const outline = this.$(".outline");
    outline.hidden = true;
    outline.removeAttribute("data-picked");
    if (this.settings.pick === "element") {
      for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) addEventListener(type, this.swallow, true);
      addEventListener("pointermove", this.onPickMove, true);
    } else this.$(".catcher").hidden = false;
    this.renderBar();
    this.renderInfo();
  }

  private stopPick() {
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "click"]) removeEventListener(type, this.swallow, true);
    removeEventListener("pointermove", this.onPickMove, true);
    removeEventListener("pointermove", this.onDragMove, true);
    removeEventListener("pointerup", this.onDragEnd, true);
    this.$(".catcher").hidden = true;
    this.dragFrom = null;
  }

  private onPickMove = (event: PointerEvent) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || element === this.ui || element === document.documentElement || element === document.body) return;
    if (element === this.trail[0] || element === this.hovered) return;
    // A glyph or an icon's stroke is part of what anyone means to film: start from the first
    // ancestor big enough to be a thing, keeping the way back for ↓.
    const trail = [element];
    let picked = element;
    while (picked.parentElement && picked.parentElement !== document.body && isSmall(picked)) {
      picked = picked.parentElement;
      trail.push(picked);
    }
    this.hovered = trail.pop()!;
    this.trail = trail;
    this.outline(toRect(this.hovered.getBoundingClientRect()), describe(this.hovered));
    this.renderInfo();
  };

  /** While picking, the page doesn't get the clicks: the click that picks shouldn't also press what it picks. */
  private swallow = (event: Event) => {
    if (event.target === this.ui) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type === "click" && this.hovered) this.choose({ element: this.hovered, rect: toRect(this.hovered.getBoundingClientRect()), label: describe(this.hovered) });
  };

  private onDragStart = (event: PointerEvent) => {
    event.preventDefault();
    this.dragFrom = { x: event.clientX, y: event.clientY };
    addEventListener("pointermove", this.onDragMove, true);
    addEventListener("pointerup", this.onDragEnd, true);
  };

  private dragRect(event: PointerEvent): Rect {
    const from = this.dragFrom!;
    return { x: Math.min(from.x, event.clientX), y: Math.min(from.y, event.clientY), width: Math.abs(event.clientX - from.x), height: Math.abs(event.clientY - from.y) };
  }

  private onDragMove = (event: PointerEvent) => {
    if (!this.dragFrom) return;
    const rect = this.dragRect(event);
    this.outline(rect, `${Math.round(rect.width)} × ${Math.round(rect.height)}`);
    this.hovered = null;
    this.renderInfo(rect);
  };

  private onDragEnd = (event: PointerEvent) => {
    if (!this.dragFrom) return;
    const rect = this.dragRect(event);
    removeEventListener("pointermove", this.onDragMove, true);
    removeEventListener("pointerup", this.onDragEnd, true);
    this.dragFrom = null;
    if (rect.width < 8 || rect.height < 8) return;
    this.choose({ element: null, rect, label: "Region", page: { ...rect, x: rect.x + scrollX, y: rect.y + scrollY } });
  };

  private choose(pick: Pick) {
    this.stopPick();
    this.picked = pick;
    this.state = "picked";
    this.showPicked();
  }

  private showPicked() {
    if (!this.picked) return;
    this.state = "picked";
    this.$(".outline").setAttribute("data-picked", "");
    this.track();
    this.renderBar();
    this.renderInfo();
  }

  /** Where the pick is now: an element where it is, a region where it was drawn on the page. */
  private pickedRect(): Rect | null {
    const pick = this.picked;
    if (!pick) return null;
    if (pick.element?.isConnected) return toRect(pick.element.getBoundingClientRect());
    if (pick.page) return { ...pick.page, x: pick.page.x - scrollX, y: pick.page.y - scrollY };
    return pick.rect;
  }

  private track = () => {
    cancelAnimationFrame(this.follow);
    this.follow = requestAnimationFrame(() => {
      if (this.state !== "picked") return;
      const rect = this.pickedRect();
      if (rect) this.outline(rect, this.picked!.label);
    });
  };

  private outline(rect: Rect, label: string) {
    const outline = this.$(".outline");
    Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    this.$(".tag").textContent = `${label} · ${Math.round(rect.width)}×${Math.round(rect.height)}`;
    outline.hidden = false;
  }

  /* ------------------------------------------------------------------ rendering */

  private renderBar() {
    const s = this.settings;
    this.shadow.querySelectorAll<HTMLButtonElement>("[data-action='pick']").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === s.pick && this.state === "picking")));
    this.shadow.querySelectorAll<HTMLButtonElement>("[data-action='mode']").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === s.mode)));
    const go = this.$<HTMLButtonElement>(".go");
    go.textContent = s.mode === "photo" ? "Capture" : "Record";
    go.disabled = !this.picked;
    this.$("[data-action='options']").setAttribute("aria-expanded", String(this.optionsOpen));
    const script = this.$<HTMLButtonElement>("[data-action='script']");
    script.hidden = s.mode !== "video";
    script.disabled = !this.picked;
    script.setAttribute("aria-pressed", String(s.moves === "script" && !!loadScript()));
  }

  /** What's outlined and what it would make: the take's size in pixels and how much it's enlarged. */
  private renderInfo(drawing?: Rect) {
    const info = this.$(".info");
    const rect = drawing ?? (this.state === "picking" ? (this.hovered ? toRect(this.hovered.getBoundingClientRect()) : null) : this.pickedRect());
    if (this.optionsOpen || (!rect && this.state !== "picking")) {
      info.hidden = true;
      return;
    }
    if (!rect) {
      const hint = this.settings.pick === "element" ? "Point at what to film and click" : "Drag across what to film";
      info.innerHTML = `<span class="what">${hint}</span><span class="keys"><kbd>Esc</kbd> to close</span>`;
      info.hidden = false;
      return;
    }
    const s = this.settings;
    const element = drawing ? null : this.state === "picking" ? this.hovered : (this.picked?.element ?? null);
    const frame = frameOf(rect, element, s);
    const viewport = { width: innerWidth, height: innerHeight };
    const stage = stageFor(frame, viewport, fillFor(viewport));
    const size = pixelSize(stage.screen, devicePixelRatio);
    const warn = stage.scale < 1 ? `<span class="warn">Bigger than the window: it'll be shrunk</span>` : stage.scale < 1.6 ? `<span class="warn">Pick tighter for sharper detail</span>` : "";
    const keys =
      this.state === "picking" && s.pick === "element"
        ? `<span class="keys"><kbd>↑</kbd> wider <kbd>↓</kbd> narrower</span>`
        : this.state === "picked"
          ? `<span class="keys"><kbd>Enter</kbd> to ${s.mode === "photo" ? "capture" : "record"}</span>`
          : "";
    info.innerHTML = `<span class="size">${size.width} × ${size.height}</span><span class="label">×${stage.scale.toFixed(stage.scale < 10 ? 1 : 0)}</span>${warn}${keys}`;
    info.hidden = false;
  }

  private renderOptions() {
    const panel = this.$(".options");
    panel.hidden = !this.optionsOpen;
    if (!this.optionsOpen) return;
    const s = this.settings;
    const choice = (setting: keyof Settings, value: string, label: string) =>
      `<button data-action="set" data-setting="${setting}" data-value="${value}" aria-pressed="${String(s[setting]) === value}">${label}</button>`;
    const toggle = (setting: keyof Settings, label: string) =>
      `<button class="switch" role="switch" aria-checked="${s[setting]}" data-action="toggle" data-setting="${setting}">${label}</button>`;
    const slider = (setting: keyof Settings, label: string, min: number, max: number, step: number, show: (v: number) => string) =>
      `<div class="slider"><input type="range" min="${min}" max="${max}" step="${step}" value="${s[setting]}" data-setting="${setting}" aria-label="${label}"><output data-for="${setting}">${show(s[setting] as number)}</output></div>`;
    const percent = (v: number) => `${Math.round(v * 100)}%`;
    const pixels = (v: number) => `${Math.round(v)}`;
    const row = (name: string, body: string, sub = false) => `<div class="row${sub ? " sub" : ""}"><span class="name">${name}</span>${body}</div>`;
    const shapes = (Object.keys(SHAPES) as Shape[]).map((shape) => choice("shape", shape, shape === "free" ? "Free" : shape)).join("");
    const backgrounds = [
      ["none", "None"],
      ["color", "Colour"],
      ["gradient", "Gradient"],
      ["image", "Image"],
    ]
      .map(([value, label]) => choice("background", value, label))
      .join("");
    const swatches = GRADIENTS.map(
      (g, k) =>
        `<button class="swatch" data-action="set" data-setting="gradient" data-value="${k}" aria-pressed="${s.gradient === k}" aria-label="${g.name}" title="${g.name}" style="background:linear-gradient(${g.angle}deg, ${g.from}, ${g.to})"></button>`,
    ).join("");
    panel.innerHTML = [
      row("Shape", `<div class="choices">${shapes}</div>`),
      // A drawn region is filmed as drawn: room is for elements.
      s.pick === "element" ? row("Room", slider("padding", "Room round the pick", 0, 0.8, 0.01, percent)) : "",
      row("Background", `<div class="choices">${backgrounds}</div>`),
      s.background === "color" ? row("Colour", `<input type="color" value="${s.color}" data-setting="color" aria-label="Background colour">`, true) : "",
      s.background === "gradient" ? row("Gradient", `<div class="swatches">${swatches}</div>`, true) : "",
      s.background === "image" ? row("Image", `<div class="choices"><button data-action="choose-image">${ICONS.image}${this.imageName ? escapeHtml(this.imageName.slice(0, 24)) : "Choose…"}</button></div>`, true) : "",
      s.background !== "none" ? row("Inset", slider("inset", "Room round the page", 0, 0.2, 0.005, percent), true) : "",
      s.background !== "none" ? row("Corners", slider("radius", "Corner radius", 0, 60, 1, pixels), true) : "",
      s.background !== "none" ? row("Shadow", toggle("shadow", "Shadow"), true) : "",
      row("Cursor", `<div class="choices">${toggle("cursor", "Drawn cursor")}${toggle("ring", "Click ring")}</div>`),
      s.mode === "video" ? row("Moves", `<div class="choices">${choice("moves", "yours", "Yours")}${choice("moves", "script", "Script")}</div>`, true) : "",
      s.mode === "video" && s.moves === "script" && !loadScript() ? row("", `<span class="note">No script on this page yet</span>`, true) : "",
      s.cursor || (s.mode === "video" && s.moves === "script") ? row("Size", slider("cursorSize", "Cursor size", 16, 96, 1, pixels), true) : "",
      s.mode === "video" ? row("Sound", `<div class="choices">${toggle("clicks", "Clicks")}${toggle("tabAudio", "Tab audio")}</div>`) : "",
      s.mode === "video" ? row("Quality", `<div class="choices">${choice("quality", "standard", "Standard")}${choice("quality", "high", "High")}</div>`) : "",
      `<p class="hint"><kbd>${this.shortcutLabel}</kbd> opens and closes · <kbd>Esc</kbd> stops a take</p>`,
    ].join("");
  }

  /* ------------------------------------------------------------------ events */

  private onClick = async (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>("[data-action]");
    if (!button) return;
    const { action, value, setting } = button.dataset;
    switch (action) {
      case "close":
        return this.close();
      case "pick":
        this.settings.pick = value as Settings["pick"];
        this.save();
        this.optionsOpen = false;
        this.renderOptions();
        return this.startPick();
      case "mode":
        this.settings.mode = value as Settings["mode"];
        this.save();
        this.renderBar();
        this.renderOptions();
        return this.renderInfo();
      case "options":
        this.optionsOpen = !this.optionsOpen;
        this.renderOptions();
        this.renderBar();
        return this.renderInfo();
      case "set": {
        const key = setting as keyof Settings;
        (this.settings as Record<string, unknown>)[key] = key === "gradient" ? Number(value) : value;
        this.save();
        this.renderOptions();
        this.renderBar();
        return this.renderInfo();
      }
      case "toggle": {
        const key = setting as keyof Settings;
        (this.settings as Record<string, unknown>)[key] = !this.settings[key];
        this.save();
        return this.renderOptions();
      }
      case "choose-image":
        return this.chooseImage();
      case "script":
        return this.editScript();
      case "go":
        return this.go();
      case "stop":
        return this.stop();
      case "retake":
        return this.closePreview();
      case "download":
        return this.download();
      case "copy":
        return this.copy();
      case "take-action":
        return this.runAction(Number(button.dataset.index), button as HTMLButtonElement);
    }
  };

  private onInput = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.setting as keyof Settings | undefined;
    if (!key) return;
    const value = input.type === "range" ? Number(input.value) : input.value;
    (this.settings as Record<string, unknown>)[key] = value;
    this.save();
    const output = this.shadow.querySelector(`output[data-for="${key}"]`);
    if (output && typeof value === "number") output.textContent = key === "radius" || key === "cursorSize" ? `${Math.round(value)}` : `${Math.round(value * 100)}%`;
  };

  private onKey = (event: KeyboardEvent) => {
    if (this.state === "editing" || this.state === "rehearsing") {
      const used = this.state === "rehearsing" ? event.key === "Escape" && (this.rehearsal?.abort(), true) : this.editing?.editor.onKey(event);
      if (used) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
      return;
    }
    const inField = event.composedPath()[0] instanceof HTMLInputElement;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (this.state === "preview") this.closePreview();
      else if (this.state === "recording") void this.stop();
      else if (this.optionsOpen) {
        this.optionsOpen = false;
        this.renderOptions();
        this.renderBar();
        this.renderInfo();
      } else if (this.state === "picking" && this.dragFrom) this.startPick();
      else this.close();
      return;
    }
    if (event.key === "Enter" && !inField && this.state === "picked" && !this.optionsOpen) {
      event.preventDefault();
      void this.go();
      return;
    }
    if (this.state === "picking" && this.hovered && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      if (event.key === "ArrowUp" && this.hovered.parentElement && this.hovered.parentElement !== document.body && this.hovered.parentElement !== document.documentElement) {
        this.trail.push(this.hovered);
        this.hovered = this.hovered.parentElement;
      } else if (event.key === "ArrowDown" && this.trail.length) this.hovered = this.trail.pop()!;
      this.outline(toRect(this.hovered.getBoundingClientRect()), describe(this.hovered));
      this.renderInfo();
    }
  };

  /* ------------------------------------------------------------------ taking */

  private get layers(): Layers {
    return { host: this.layer, ignore: (target) => target === this.ui };
  }

  private hideControls() {
    for (const selector of [".bar", ".info", ".options", ".outline"]) this.$(selector).hidden = true;
  }

  private showControls() {
    this.$(".bar").hidden = false;
    this.renderBar();
    this.renderOptions();
    if (this.picked) this.showPicked();
    else this.startPick();
  }

  private async go() {
    if (!this.picked || this.state === "busy" || this.state === "recording") return;
    const scripted = this.settings.mode === "video" && this.settings.moves === "script";
    const script = scripted ? loadScript() : null;
    if (scripted && !script) return this.toast("No script on this page yet.");
    this.state = "busy";
    this.optionsOpen = false;
    this.hideControls();
    try {
      if (this.settings.mode === "photo") {
        this.showResult(await takePhoto(this.picked, this.settings, this.layers, this.image));
        return;
      }
      const running = await startVideo(this.picked, this.settings, this.layers, this.image, script);
      this.running = running;
      // A script ends the take itself, unless it was stopped first.
      void running.finished?.then(() => {
        if (this.running === running) void this.stop();
      });
      this.state = "recording";
      const hud = this.$(".hud");
      hud.style.top = `${Math.max(10, this.running.screen.y - 50)}px`;
      hud.hidden = false;
      const time = this.$(".time");
      const started = this.running.started;
      const show = () => {
        const seconds = Math.floor((performance.now() - started) / 1000);
        time.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      };
      show();
      this.timer = window.setInterval(show, 250);
    } catch (error) {
      this.state = "picked";
      const name = (error as Error).name;
      this.toast(name === "NotAllowedError" || name === "AbortError" ? "Sharing was cancelled." : `Couldn't film: ${(error as Error).message}`);
      this.showControls();
    }
  }

  /* ------------------------------------------------------------------ scripts */

  /** Opens the script editor on the stage, at the size the take is filmed. */
  private async editScript() {
    if (!this.picked || this.state !== "picked") return;
    const rect = this.pickedRect();
    if (!rect) return;
    this.state = "editing";
    this.optionsOpen = false;
    this.hideControls();
    const viewport = { width: innerWidth, height: innerHeight };
    const stage = stageFor(frameOf(rect, this.picked.element, this.settings), viewport, fillFor(viewport), { x: scrollX, y: scrollY });
    const leave = await enterStage(stage);
    const box = frameBox(stage.screen, this.layer);
    const editor = new Editor({
      root: this.shadow,
      stage,
      hit: pageHit(this.layers),
      script: loadScript(),
      onChange: (script) => saveScript(script),
      onPreview: (script) => void this.rehearse(script),
      onDone: () => void this.doneEditing(),
    });
    this.editing = { editor, stage, box, leave };
  }

  /** Leaves the editor: the page back as it was, and the script set to play if there is one. */
  private async doneEditing() {
    const editing = this.editing;
    if (!editing || this.state !== "editing") return;
    this.editing = null;
    this.state = "busy";
    editing.editor.destroy();
    editing.box.remove();
    await editing.leave();
    if (loadScript()?.steps.length) {
      this.settings.moves = "script";
      this.save();
    }
    this.state = "picked";
    this.showControls();
  }

  /** Plays the script on the stage without filming it, to see it before recording. */
  private async rehearse(script: Script) {
    const editing = this.editing;
    if (!editing || this.state !== "editing") return;
    this.state = "rehearsing";
    editing.editor.hidden = true;
    // Made in the click that asked for it: browsers start sound only from one.
    const mixer = this.settings.clicks ? new Mixer() : null;
    const actor = createActor(this.layers, { size: this.settings.cursorSize, onPress: mixer ? (down) => mixer.click(down) : undefined, ring: this.settings.ring });
    const rehearsal = new AbortController();
    this.rehearsal = rehearsal;
    const hud = this.$(".hud");
    hud.style.top = `${Math.max(10, editing.stage.screen.y - 50)}px`;
    this.$(".time").textContent = "Preview";
    // Not filming: no red dot.
    this.$(".dot").hidden = true;
    hud.hidden = false;
    try {
      await play(script, {
        ...actor,
        toScreen: (p) => toScreen(editing.stage, { x: scrollX, y: scrollY }, p),
        scale: editing.stage.scale,
        onKey: mixer ? () => mixer.key() : undefined,
        signal: rehearsal.signal,
        lead: 0.3,
      });
      if (!rehearsal.signal.aborted) await new Promise((done) => setTimeout(done, 500));
    } finally {
      actor.dispose();
      mixer?.close();
      hud.hidden = true;
      this.$(".dot").hidden = false;
      this.rehearsal = null;
      this.state = "editing";
      editing.editor.hidden = false;
    }
  }

  private async stop() {
    if (this.state === "rehearsing") return this.rehearsal?.abort();
    if (!this.running) return;
    clearInterval(this.timer);
    this.$(".hud").hidden = true;
    const running = this.running;
    this.running = null;
    this.state = "busy";
    this.showResult(await running.stop());
  }

  private showResult(result: Result) {
    this.result = result;
    this.state = "preview";
    URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = URL.createObjectURL(result.blob);
    const media =
      result.kind === "photo"
        ? `<img src="${this.resultUrl}" alt="The photo">`
        : `<video src="${this.resultUrl}" autoplay loop muted playsinline controls></video>`;
    const ext = result.type.includes("mp4") ? "MP4" : result.type.includes("png") ? "PNG" : "WebM";
    const parts = [`${result.width} × ${result.height}`, result.seconds ? `${result.seconds.toFixed(1)} s` : "", `${(result.blob.size / 1e6).toFixed(1)} MB`, ext].filter(Boolean);
    this.takeActions = actionsFor(result);
    const actions = this.takeActions
      .map((action, index) => `<button data-action="take-action" data-index="${index}">${action.icon ? svg(action.icon) : ""}<span>${escapeHtml(action.label)}</span></button>`)
      .join("");
    const sheet = this.$(".sheet");
    sheet.innerHTML = `
      <div class="media">${media}</div>
      <div class="footer">
        <span class="meta">${parts.join(" · ")}</span>
        <button data-action="retake">${ICONS.rotate_ccw}Retake</button>
        ${result.kind === "photo" ? `<button data-action="copy">${ICONS.copy}Copy</button>` : ""}
        ${actions}
        <button class="go" data-action="download">${ICONS.download}Download</button>
      </div>`;
    this.$(".backdrop").hidden = false;
    sheet.hidden = false;
    sheet.querySelector<HTMLButtonElement>(".go")?.focus();
  }

  private closePreview() {
    if (this.state !== "preview") return;
    this.$(".sheet").hidden = true;
    this.$(".backdrop").hidden = true;
    this.$(".sheet").innerHTML = "";
    URL.revokeObjectURL(this.resultUrl);
    this.resultUrl = "";
    this.result = null;
    this.state = "picked";
    this.showControls();
  }

  private download() {
    if (!this.result) return;
    const ext = this.result.type.includes("mp4") ? "mp4" : this.result.type.includes("png") ? "png" : "webm";
    const link = document.createElement("a");
    link.href = this.resultUrl;
    link.download = `closeup-${stamp()}.${ext}`;
    link.click();
  }

  /**
   * Runs one of the page's own actions on the take: its button counts up while it works, then
   * shows it's done (once is enough), and what it said, or why it failed, is said in a toast.
   */
  private async runAction(index: number, button: HTMLButtonElement) {
    const action = this.takeActions[index];
    const result = this.result;
    if (!action || !result || button.disabled) return;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    const label = button.querySelector("span");
    const progress = (done: number) => {
      if (label) label.textContent = `${action.label} ${Math.round(Math.min(1, Math.max(0, done)) * 100)}%`;
    };
    try {
      const said = await action.run(result, { progress });
      button.innerHTML = `${ICONS.check}<span>${escapeHtml(action.label)}</span>`;
      this.toast(said || "Saved.");
    } catch (error) {
      if (label) label.textContent = action.label;
      button.disabled = false;
      this.toast((error as Error).message || "That didn't work.");
    } finally {
      button.removeAttribute("aria-busy");
    }
  }

  private async copy() {
    if (this.result?.kind !== "photo") return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": this.result.blob })]);
      this.toast("Copied.");
    } catch {
      this.toast("Couldn't copy: download it instead.");
    }
  }

  private chooseImage() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      if (!file) return;
      this.image?.close();
      this.image = await createImageBitmap(file);
      this.imageName = file.name;
      this.renderOptions();
    });
    input.click();
  }

  private save() {
    saveSettings(this.settings);
  }

  private toast(message: string) {
    const toast = this.$(".toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(Number(toast.dataset.timer));
    toast.dataset.timer = String(setTimeout(() => (toast.hidden = true), 3200));
  }
}
