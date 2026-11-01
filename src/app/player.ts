// The show clock: the song's audio when there is one, the wall clock otherwise. The 3D view asks it
// for the time every frame; the controls subscribe to it for play state and position.

export class Player {
  readonly audio = new Audio();
  duration = 0;
  playing = false;
  /** Starts over at the end instead of stopping (the move gallery's shows). */
  private loop = false;
  private url: string | undefined;
  private audioReady = false;
  private pausedAt = 0;
  private wallStart = 0;
  private lastAudioT = -1;
  private lastAudioWall = 0;
  private shown = 0;
  private listeners = new Set<() => void>();

  constructor() {
    this.audio.preload = 'auto';
    this.audio.addEventListener('ended', () => {
      if (this.playing && this.loop) this.restart();
      else if (this.playing) {
        this.pause();
        this.pausedAt = this.duration;
      }
    });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** A new song (or none): stops playback and rewinds. `loop`: start over at the end. */
  load(audio: Blob | undefined, duration: number, loop = false) {
    this.pause();
    this.loop = loop;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = audio ? URL.createObjectURL(audio) : undefined;
    this.audioReady = !!audio;
    if (this.url) this.audio.src = this.url;
    else this.audio.removeAttribute('src');
    this.audio.load();
    this.duration = duration;
    this.pausedAt = 0;
    this.shown = 0;
    this.emit();
  }

  /** The show time now. currentTime advances in coarse steps in some browsers, so it's extrapolated;
   * time stays monotonic through small audio-clock jitter but follows real jumps. */
  now(): number {
    let t: number;
    if (!this.playing) t = this.pausedAt;
    else if (this.audioReady && !this.audio.paused) {
      const wall = performance.now();
      if (this.audio.currentTime !== this.lastAudioT) {
        this.lastAudioT = this.audio.currentTime;
        this.lastAudioWall = wall;
      }
      t = this.lastAudioT + Math.min(0.3, (wall - this.lastAudioWall) / 1000);
    } else if (this.audioReady) t = this.audio.currentTime;   // waiting to start
    else t = this.pausedAt + (performance.now() - this.wallStart) / 1000;
    if (this.playing && t < this.shown && this.shown - t < 0.12) t = this.shown;
    if (this.playing && this.duration > 0 && t >= this.duration) {
      if (this.loop) {
        this.restart();
        t = 0;
      } else {
        this.pause();
        t = this.pausedAt = this.duration;
      }
    }
    this.shown = t;
    return t;
  }

  async play() {
    if (!this.duration || this.playing) return;
    if (this.pausedAt >= this.duration - 0.05) this.pausedAt = 0;
    this.playing = true;
    this.emit();
    if (this.audioReady) {
      this.audio.currentTime = this.pausedAt;
      this.lastAudioT = -1;
      try {
        await this.audio.play();
        return;
      } catch (err) {
        console.warn('Audio would not play', err);
        this.audioReady = false;               // fall back to silent wall-clock playback
      }
    }
    this.wallStart = performance.now();
  }

  /** Back to the start, still playing. */
  private restart() {
    this.pausedAt = this.shown = 0;
    this.wallStart = performance.now();
    if (this.audioReady) {
      this.audio.currentTime = 0;
      this.lastAudioT = -1;
      if (this.audio.paused) void this.audio.play().catch(() => undefined);
    }
  }

  pause() {
    if (!this.playing) return;
    this.pausedAt = this.now();
    this.playing = false;
    this.audio.pause();
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(t: number) {
    t = Math.max(0, Math.min(this.duration, t));
    this.pausedAt = this.shown = t;
    if (this.playing) {
      if (this.audioReady) {
        this.audio.currentTime = t;
        this.lastAudioT = -1;
      } else this.wallStart = performance.now();
    }
    this.emit();
  }
}
