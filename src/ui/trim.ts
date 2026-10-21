/**
 * The trim bar under a finished video: its frames in a strip, a window over the part kept with
 * a handle at each end (dragged, or moved by the arrow keys), the rest dimmed, a playhead, and
 * the speeds. The preview plays the kept part, at its speed, round and round.
 */

import { clock, type Edit, endAt, lengthOf, SPEEDS, startAt, whole } from "../edit.ts";
import { filmstrip } from "../export.ts";
import type { Result } from "../take.ts";

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback(callback: (now: number, frame: { mediaTime: number }) => void): number;
  cancelVideoFrameCallback(id: number): void;
};

/** How far an arrow key moves a handle, in seconds (Shift: a second). */
const NUDGE = 0.1;

const speedLabel = (speed: number) => `${speed}×`;

export class TrimBar {
  readonly element = document.createElement("div");
  edit: Edit;
  private readonly track: HTMLElement;
  private readonly strip: HTMLCanvasElement;
  private frame = 0;
  private readonly stopped = new AbortController();
  private dragging: "start" | "end" | null = null;

  private readonly video: FrameVideo;

  constructor(
    video: HTMLVideoElement,
    private readonly take: Result,
    /** How long the take is, in seconds. */
    readonly duration: number,
    host: Element,
    private readonly onChange: (edit: Edit) => void,
  ) {
    this.video = video as FrameVideo;
    this.edit = whole(duration);
    this.element.className = "trim";
    this.element.innerHTML = `
      <div class="track">
        <canvas class="strip" aria-hidden="true"></canvas>
        <div class="shade before"></div><div class="shade after"></div>
        <div class="window"></div>
        <span class="grip start" role="slider" tabindex="0" aria-label="Start"></span>
        <span class="grip end" role="slider" tabindex="0" aria-label="End"></span>
        <div class="head" aria-hidden="true"></div>
      </div>
      <div class="under">
        <span class="range"></span>
        <div class="speeds" role="group" aria-label="Speed">
          ${SPEEDS.map((speed) => `<button data-speed="${speed}" aria-pressed="${speed === 1}">${speedLabel(speed)}</button>`).join("")}
        </div>
      </div>`;
    this.track = this.element.querySelector(".track")!;
    this.strip = this.element.querySelector(".strip")!;
    this.track.addEventListener("pointerdown", this.onDown);
    this.element.addEventListener("keydown", this.onKey);
    this.element.addEventListener("click", this.onClick);
    this.render();
    this.loop();
    // The strip once the bar is laid out, at the screen's density.
    requestAnimationFrame(() => {
      const box = this.strip.getBoundingClientRect();
      this.strip.width = Math.max(1, Math.round(box.width * devicePixelRatio));
      this.strip.height = Math.max(1, Math.round(box.height * devicePixelRatio));
      void filmstrip(this.take, host, this.strip, this.stopped.signal).catch(() => undefined);
    });
  }

  destroy() {
    this.stopped.abort();
    this.video.cancelVideoFrameCallback(this.frame);
    this.element.remove();
  }

  /** Plays the kept part round and round, the playhead following. */
  private loop() {
    const tick = (_: number, frame: { mediaTime: number }) => {
      const { from, to } = this.edit;
      if (frame.mediaTime >= to - 0.01 || frame.mediaTime < from - 0.05) this.video.currentTime = from;
      this.placeHead(frame.mediaTime);
      this.frame = this.video.requestVideoFrameCallback(tick);
    };
    this.frame = this.video.requestVideoFrameCallback(tick);
  }

  private share = (t: number) => `${(100 * Math.max(0, Math.min(this.duration, t))) / this.duration}%`;

  private placeHead(t: number) {
    (this.element.querySelector(".head") as HTMLElement).style.left = this.share(t);
  }

  private render() {
    const { from, to, speed } = this.edit;
    const q = <T extends HTMLElement>(selector: string) => this.element.querySelector(selector) as T;
    Object.assign(q(".shade.before").style, { left: "0", width: this.share(from) });
    Object.assign(q(".shade.after").style, { left: this.share(to), right: "0" });
    Object.assign(q(".window").style, { left: this.share(from), width: `calc(${this.share(to)} - ${this.share(from)})` });
    q(".grip.start").style.left = this.share(from);
    q(".grip.end").style.left = this.share(to);
    for (const [selector, value] of [[".grip.start", from], [".grip.end", to]] as const) {
      const grip = q(selector);
      grip.setAttribute("aria-valuemin", "0");
      grip.setAttribute("aria-valuemax", this.duration.toFixed(1));
      grip.setAttribute("aria-valuenow", value.toFixed(1));
      grip.setAttribute("aria-valuetext", clock(value));
    }
    q(".range").textContent = `${clock(from)} – ${clock(to)} · ${lengthOf(this.edit).toFixed(1)} s`;
    for (const button of this.element.querySelectorAll<HTMLButtonElement>("[data-speed]")) button.setAttribute("aria-pressed", String(Number(button.dataset.speed) === speed));
  }

  private change(edit: Edit) {
    const moved = edit.from !== this.edit.from ? edit.from : edit.to !== this.edit.to ? edit.to : null;
    this.edit = edit;
    this.video.playbackRate = edit.speed;
    // Showing the frame at the end being moved, as the handle goes.
    if (moved !== null) this.video.currentTime = Math.min(moved, edit.to - 0.01);
    this.render();
    this.onChange(edit);
  }

  private timeAt(clientX: number) {
    const box = this.track.getBoundingClientRect();
    return (Math.max(0, Math.min(box.width, clientX - box.left)) / Math.max(1, box.width)) * this.duration;
  }

  private onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const grip = (event.target as Element).closest<HTMLElement>(".grip");
    if (grip) {
      event.preventDefault();
      this.dragging = grip.classList.contains("start") ? "start" : "end";
      grip.focus();
      this.track.setPointerCapture(event.pointerId);
      this.track.addEventListener("pointermove", this.onMove);
      this.track.addEventListener("pointerup", this.onUp, { once: true });
      this.track.addEventListener("pointercancel", this.onUp, { once: true });
      return;
    }
    // Elsewhere on the strip: the preview goes there, inside the part kept.
    const { from, to } = this.edit;
    this.video.currentTime = Math.max(from, Math.min(to - 0.01, this.timeAt(event.clientX)));
  };

  private onMove = (event: PointerEvent) => {
    const t = this.timeAt(event.clientX);
    this.change(this.dragging === "start" ? startAt(this.edit, t) : endAt(this.edit, t, this.duration));
  };

  private onUp = () => {
    this.dragging = null;
    this.track.removeEventListener("pointermove", this.onMove);
  };

  private onKey = (event: KeyboardEvent) => {
    const grip = (event.target as Element).closest<HTMLElement>(".grip");
    if (!grip) return;
    const start = grip.classList.contains("start");
    const now = start ? this.edit.from : this.edit.to;
    const step = event.shiftKey ? 1 : NUDGE;
    const to =
      event.key === "ArrowLeft" || event.key === "ArrowDown"
        ? now - step
        : event.key === "ArrowRight" || event.key === "ArrowUp"
          ? now + step
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? this.duration
              : null;
    if (to === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.change(start ? startAt(this.edit, to) : endAt(this.edit, to, this.duration));
  };

  private onClick = (event: Event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>("[data-speed]");
    if (button) this.change({ ...this.edit, speed: Number(button.dataset.speed) });
  };
}
