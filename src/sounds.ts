/**
 * The take's sound: the tab's own, if it was shared, a click for each press of the drawn cursor
 * and a softer tick for each key a script types, synthesised (nothing downloaded) and played to
 * the speakers too, so the person recording hears what the video will. All of it mixed into one
 * audio track for the recorder.
 */

export class Mixer {
  readonly context = new AudioContext();
  private readonly destination = this.context.createMediaStreamDestination();
  private readonly monitor = this.context.createGain();
  private readonly noise: AudioBuffer;
  private sources: MediaStreamAudioSourceNode[] = [];

  constructor() {
    this.monitor.gain.value = 0.6;
    this.monitor.connect(this.context.destination);
    // Half a second of white noise, the body of every click.
    const length = Math.round(this.context.sampleRate * 0.5);
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let k = 0; k < length; k++) data[k] = Math.random() * 2 - 1;
  }

  get track() {
    return this.destination.stream.getAudioTracks()[0];
  }

  /** The tab's own sound, into the recording only: the tab already plays it aloud. */
  add(track: MediaStreamTrack) {
    const source = this.context.createMediaStreamSource(new MediaStream([track]));
    source.connect(this.destination);
    this.sources.push(source);
  }

  /** A trackpad's click: a firmer tick going down, a lighter one coming up. */
  click(down: boolean) {
    const c = this.context;
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    const out = c.createGain();
    out.connect(this.destination);
    out.connect(this.monitor);

    const tick = c.createBufferSource();
    tick.buffer = this.noise;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = down ? 3000 : 4200;
    band.Q.value = 1.1;
    const tickGain = c.createGain();
    const peak = down ? 0.5 : 0.22;
    const length = down ? 0.028 : 0.018;
    tickGain.gain.setValueAtTime(0.0001, now);
    tickGain.gain.exponentialRampToValueAtTime(peak, now + 0.001);
    tickGain.gain.exponentialRampToValueAtTime(0.0001, now + length);
    tick.connect(band).connect(tickGain).connect(out);
    tick.start(now, Math.random() * 0.4, length + 0.01);

    if (down) {
      // A low knock under the tick, felt more than heard.
      const knock = c.createOscillator();
      knock.frequency.setValueAtTime(190, now);
      knock.frequency.exponentialRampToValueAtTime(90, now + 0.04);
      const knockGain = c.createGain();
      knockGain.gain.setValueAtTime(0.0001, now);
      knockGain.gain.exponentialRampToValueAtTime(0.3, now + 0.002);
      knockGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      knock.connect(knockGain).connect(out);
      knock.start(now);
      knock.stop(now + 0.06);
    }
  }

  /** A key going down: a short, soft tick, lighter than a click, each a little different. */
  key() {
    const c = this.context;
    if (c.state === "suspended") void c.resume();
    const now = c.currentTime;
    const tick = c.createBufferSource();
    tick.buffer = this.noise;
    const band = c.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2200 + Math.random() * 900;
    band.Q.value = 1.4;
    const gain = c.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
    tick.connect(band).connect(gain);
    gain.connect(this.destination);
    gain.connect(this.monitor);
    tick.start(now, Math.random() * 0.4, 0.03);
  }

  close() {
    this.sources.forEach((source) => source.disconnect());
    void this.context.close();
  }
}
