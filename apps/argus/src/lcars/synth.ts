/**
 * @file The LCARS voice: every sound the page makes, synthesized in the
 * browser from a compact spectral model. No recording ships.
 *
 * A model is a spectral resynthesis of a reference clip: partial tracks
 * (a start frame, a pitch curve and an amplitude curve each) and the
 * residual as thirty-two log-spaced noise bands with their own amplitude
 * curves, on an 11.6 ms grid. The player drives one sine oscillator per
 * track and one band-pass noise voice per band from those curves through
 * Web Audio. The models and the bank that names them (a cue for each
 * event, a beep for each pill) are static files under `sound/`, built by
 * `tools/trek-sound`.
 *
 * The page's four frame beeps (press, arrive, retreat, refuse) play through
 * this voice too, unless the porter serves a recording of its own for them
 * (`PORTER_SOUNDS_DIR`), which the page learns from `sounds/index.json`.
 *
 * @module
 */

/** A spectral model as `tools/trek-sound/model_export.py` writes it. */
export interface SynthModel {
  /** The cue's name. */
  name: string;
  /** The reference clip it was made from, by name only. */
  source: string;
  /** The analysis sample rate. */
  sr: number;
  /** Seconds per frame of the curves. */
  frame: number;
  /** How many frames the clip runs. */
  frames: number;
  /** The clip's peak amplitude, for levelling. */
  peak: number;
  /** The partial tracks: a start frame, a pitch curve in Hz, an amplitude curve. */
  tracks: Array<[number, number[], number[]]>;
  /** The residual: band centres in Hz, the bands' Q, and per frame each band's RMS amplitude. */
  noise: { centres: number[]; q: number; frames: number[][] };
}

/** The bank: which model file each cue and each pill plays. */
export interface SynthBank {
  /** The event cues by name. */
  cues: Record<string, string>;
  /** The pills by label; each takes one computer beep. */
  pills: Record<string, string>;
}

/** How a model is played. */
export interface PlayOptions {
  /** The first frame to play. */
  start?: number;
  /** The frame to stop at. */
  end?: number;
  /** Speed: 1 as recorded, 2 twice as fast. */
  rate?: number;
  /** A pitch multiplier. */
  pitch?: number;
  /** A gain multiplier. */
  gain?: number;
}

/** Calibration: a unit-variance noise source through two band-passes, against the model's band RMS (set by an offline render). */
const NOISE_GAIN: number = 24.5;

/** The voice's level into the page, under the mute. */
const VOICE_LEVEL: number = 0.6;

/**
 * Makes four seconds of unit-variance white noise, the source every band voice filters.
 *
 * @param context - The audio context.
 * @returns The buffer.
 */
export function noise_make(context: BaseAudioContext): AudioBuffer {
  const n: number = context.sampleRate * 4;
  const buffer: AudioBuffer = context.createBuffer(1, n, context.sampleRate);
  const data: Float32Array = buffer.getChannelData(0);
  for (let i: number = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * 1.732;
  return buffer;
}

/**
 * Plays a model: one oscillator per partial track, one band-pass noise voice per residual band.
 *
 * @param context - The audio context.
 * @param out - Where the voices go.
 * @param noise - The white noise source.
 * @param t0 - When the clip starts, in the context's time.
 * @param model - The model.
 * @param options - How it is played.
 * @returns How many oscillators were started and how long the clip runs.
 */
export function model_play(context: BaseAudioContext, out: AudioNode, noise: AudioBuffer, t0: number, model: SynthModel, options: PlayOptions = {}): { voices: number; seconds: number } {
  const rate: number = options.rate ?? 1;
  const pitch: number = options.pitch ?? 1;
  const frame: number = model.frame / rate;
  const start: number = options.start ?? 0;
  const end: number = Math.min(model.frames, options.end ?? model.frames);
  const level: number = ((options.gain ?? 1) * VOICE_LEVEL) / (model.peak || 1);
  let voices: number = 0;
  for (const [g0, hz, amp] of model.tracks) {
    const tEnd: number = g0 + hz.length - 1;
    if (tEnd <= start || g0 >= end) continue;
    const a: number = Math.max(g0, start);
    const b: number = Math.min(tEnd, end);
    if (b <= a) continue;
    const hzCurve: Float32Array = Float32Array.from(hz.slice(a - g0, b - g0 + 1), (v: number): number => v * pitch);
    const ampCurve: Float32Array = Float32Array.from([0, ...amp.slice(a - g0, b - g0 + 1).map((v: number): number => v * level), 0]);
    const at: number = t0 + (a - start) * frame;
    const duration: number = (b - a) * frame;
    const oscillator: OscillatorNode = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(hzCurve[0] ?? 440, at);
    if (hzCurve.length > 1) oscillator.frequency.setValueCurveAtTime(hzCurve, at, duration);
    const gain: GainNode = context.createGain();
    gain.gain.setValueAtTime(0, at - frame);
    gain.gain.setValueCurveAtTime(ampCurve, at - frame, duration + 2 * frame);
    oscillator.connect(gain);
    gain.connect(out);
    oscillator.start(at - frame);
    oscillator.stop(at + duration + frame + 0.01);
    voices++;
  }
  const bands: number[][] = model.noise.frames;
  const na: number = Math.max(0, start);
  const nb: number = Math.min(bands.length, end);
  if (nb > na + 1) {
    const source: AudioBufferSourceNode = context.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    source.loopStart = Math.random() * 2;
    const duration: number = (nb - na) * frame;
    model.noise.centres.forEach((centre: number, band: number): void => {
      const curve: Float32Array = Float32Array.from([0, ...bands.slice(na, nb).map((row: number[]): number => (row[band] ?? 0) * level * NOISE_GAIN), 0]);
      if (curve.every((v: number): boolean => v < 1e-6)) return;
      // two band-passes in series: skirts steep enough that the bands do not add up to white noise
      const first: BiquadFilterNode = context.createBiquadFilter();
      first.type = 'bandpass';
      first.frequency.setValueAtTime(centre * pitch, t0);
      first.Q.setValueAtTime(model.noise.q, t0);
      const second: BiquadFilterNode = context.createBiquadFilter();
      second.type = 'bandpass';
      second.frequency.setValueAtTime(centre * pitch, t0);
      second.Q.setValueAtTime(model.noise.q, t0);
      const gain: GainNode = context.createGain();
      gain.gain.setValueAtTime(0, t0 - frame);
      gain.gain.setValueCurveAtTime(curve, t0 - frame, duration + 2 * frame);
      source.connect(first);
      first.connect(second);
      second.connect(gain);
      gain.connect(out);
    });
    source.start(t0 - frame);
    source.stop(t0 + duration + frame + 0.01);
  }
  return { voices, seconds: (end - start) * frame };
}

/**
 * The file a pill's beep comes from, by its label; a label the bank does not name takes the press beep.
 *
 * @param bank - The bank.
 * @param label - The pill's label, as drawn.
 * @returns The model file, or null when the bank has no press beep either.
 */
export function pillFile_find(bank: SynthBank, label: string): string | null {
  return bank.pills[label] ?? bank.cues['press'] ?? null;
}

/**
 * The page's voice: loads the bank and its models on demand and plays cues and pill beeps.
 */
export class SynthVoice {
  private context: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted: boolean = false;
  private bank: Promise<SynthBank | null> | null = null;
  private readonly models: Map<string, Promise<SynthModel | null>> = new Map<string, Promise<SynthModel | null>>();
  private lastAt: number = 0;
  private readonly tally: { played: number; loaded: number; missing: number; voices: number } = { played: 0, loaded: 0, missing: 0, voices: 0 };

  /**
   * Makes a voice.
   *
   * @param base - The URL under which `bank.json` and the models are served, relative to the page.
   */
  constructor(private readonly base: string = 'sound/') {}

  /**
   * What the voice has done, for a smoke scenario or a diagnosis: cues played, models loaded and missing, oscillators started.
   *
   * @returns A copy of the tally.
   */
  public tally_get(): { played: number; loaded: number; missing: number; voices: number } {
    return { ...this.tally };
  }

  /**
   * Mutes or unmutes the voice; the audio pill owns this.
   *
   * @param muted - Whether the voice is silent.
   */
  public muted_set(muted: boolean): void {
    this.muted = muted;
    if (this.out !== null && this.context !== null) this.out.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.01);
  }

  /**
   * Whether the voice is muted.
   *
   * @returns True when silent.
   */
  public muted_is(): boolean {
    return this.muted;
  }

  /**
   * Plays an event cue by name; nothing when the bank has no such cue.
   *
   * @param name - The cue.
   * @param options - How it is played.
   */
  public cue_play(name: string, options: PlayOptions = {}): void {
    if (this.muted) return;
    void this.bank_load().then((bank: SynthBank | null): void => {
      const file: string | undefined = bank?.cues[name];
      if (file !== undefined) this.file_play(file, options);
    });
  }

  /**
   * Plays a pill's beep by its label.
   *
   * @param label - The pill's label, as drawn.
   */
  public pill_play(label: string): void {
    if (this.muted) return;
    void this.bank_load().then((bank: SynthBank | null): void => {
      const file: string | null = bank === null ? null : pillFile_find(bank, label);
      if (file !== null) this.file_play(file, {});
    });
  }

  /**
   * Fetches the bank and every model it names, so the first cue is prompt.
   */
  public preload(): void {
    void this.bank_load().then((bank: SynthBank | null): void => {
      if (bank === null) return;
      for (const file of new Set<string>([...Object.values(bank.cues), ...Object.values(bank.pills)])) void this.model_load(file);
    });
  }

  /**
   * Loads the bank once.
   *
   * @returns The bank, or null when it cannot be read.
   */
  public bank_load(): Promise<SynthBank | null> {
    if (this.bank === null) {
      this.bank = fetch(`${this.base}bank.json`)
        .then((response: Response): Promise<SynthBank> => (response.ok ? (response.json() as Promise<SynthBank>) : Promise.reject(new Error(String(response.status)))))
        .catch((): null => null);
    }
    return this.bank;
  }

  /**
   * Loads a model once.
   *
   * @param file - Its file under the base.
   * @returns The model, or null when it cannot be read.
   */
  public model_load(file: string): Promise<SynthModel | null> {
    let loading: Promise<SynthModel | null> | undefined = this.models.get(file);
    if (loading === undefined) {
      loading = fetch(`${this.base}${file}`)
        .then((response: Response): Promise<SynthModel> => (response.ok ? (response.json() as Promise<SynthModel>) : Promise.reject(new Error(String(response.status)))))
        .then((model: SynthModel): SynthModel => { this.tally.loaded++; return model; })
        .catch((): null => { this.tally.missing++; return null; });
      this.models.set(file, loading);
    }
    return loading;
  }

  private context_get(): { context: AudioContext; out: GainNode; noise: AudioBuffer } | null {
    if (this.context === null) {
      const Context: typeof AudioContext | undefined = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context === undefined) return null;
      this.context = new Context();
      this.out = this.context.createGain();
      this.out.gain.value = this.muted ? 0 : 1;
      // a cue of a few hundred partials can sum past full scale: the compressor keeps the loud ones from clipping
      const compressor: DynamicsCompressorNode = this.context.createDynamicsCompressor();
      compressor.threshold.value = -12;
      compressor.ratio.value = 6;
      this.out.connect(compressor);
      compressor.connect(this.context.destination);
      this.noise = noise_make(this.context);
    }
    if (this.context.state === 'suspended') void this.context.resume();
    return { context: this.context, out: this.out as GainNode, noise: this.noise as AudioBuffer };
  }

  private file_play(file: string, options: PlayOptions): void {
    const audio = this.context_get();
    if (audio === null) return;
    void this.model_load(file).then((model: SynthModel | null): void => {
      if (model === null || this.muted) return;
      // two cues asked for in the same instant play a little apart, so neither masks the other
      const now: number = audio.context.currentTime + 0.02;
      const at: number = Math.max(now, this.lastAt + 0.08);
      this.lastAt = at;
      try {
        const played = model_play(audio.context, audio.out, audio.noise, at, model, options);
        this.tally.played++;
        this.tally.voices += played.voices;
      } catch {
        // a context closed under the page, or a curve the browser refused: the cue is lost, the page is not
      }
    });
  }
}

/** The page's one voice. */
export const synthVoice: SynthVoice = new SynthVoice();
