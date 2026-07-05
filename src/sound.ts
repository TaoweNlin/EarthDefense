// Web Audio 合成音效：零音频资产，全部程序合成。
// 统一走 master 增益，支持静音（localStorage 记忆）。

type SfxName =
  | 'shoot' | 'prism' | 'arc' | 'missile' | 'explosion' | 'intercept'
  | 'build' | 'upgrade' | 'sell' | 'click' | 'deny'
  | 'alarm' | 'cityhit' | 'jam' | 'win' | 'lose';

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  muted = localStorage.getItem('earthdef-mute') === '1';
  private lastPlay: Record<string, number> = {};

  private ensure(): boolean {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.22;
        this.master.connect(this.ctx.destination);
      } catch { return false; }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    localStorage.setItem('earthdef-mute', this.muted ? '1' : '0');
    return this.muted;
  }

  /** 扫频振荡音 */
  private tone(f0: number, f1: number, dur: number, type: OscillatorType, gain: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  /** 滤波噪声（爆炸/发射） */
  private noise(dur: number, cutoff0: number, cutoff1: number, gain: number, delay = 0) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff0, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, cutoff1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t);
  }

  play(name: SfxName, throttleMs = 60) {
    if (this.muted) return;
    const now = performance.now();
    if (now - (this.lastPlay[name] ?? 0) < throttleMs) return;
    this.lastPlay[name] = now;
    if (!this.ensure()) return;

    switch (name) {
      case 'shoot':     this.tone(820, 240, 0.08, 'square', 0.16); break;
      case 'prism':     this.tone(340, 90, 0.3, 'sawtooth', 0.28); this.tone(680, 180, 0.3, 'sine', 0.18); break;
      case 'arc':       this.noise(0.09, 6200, 2000, 0.14); this.tone(1400, 300, 0.07, 'square', 0.07); break;
      case 'missile':   this.noise(0.35, 900, 3400, 0.24); break;
      case 'explosion': this.noise(0.42, 2600, 90, 0.4); this.tone(160, 40, 0.35, 'sine', 0.3); break;
      case 'intercept': this.noise(0.5, 3400, 120, 0.42); this.tone(520, 60, 0.45, 'sawtooth', 0.2); break;
      case 'build':     this.tone(300, 900, 0.16, 'triangle', 0.25); break;
      case 'upgrade':   this.tone(520, 520, 0.09, 'sine', 0.25); this.tone(780, 780, 0.14, 'sine', 0.25, 0.09); break;
      case 'sell':      this.tone(700, 260, 0.18, 'triangle', 0.2); break;
      case 'click':     this.tone(1150, 900, 0.035, 'square', 0.1); break;
      case 'deny':      this.tone(220, 160, 0.12, 'square', 0.18); break;
      case 'alarm':     this.tone(620, 620, 0.16, 'square', 0.14); this.tone(460, 460, 0.16, 'square', 0.14, 0.2); break;
      case 'cityhit':   this.tone(120, 45, 0.5, 'sine', 0.45); this.noise(0.3, 1200, 100, 0.25); break;
      case 'jam':       this.tone(900, 100, 0.5, 'sawtooth', 0.16); break;
      case 'win':
        [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f, 0.32, 'triangle', 0.24, i * 0.16));
        break;
      case 'lose':
        [392, 330, 262, 196].forEach((f, i) => this.tone(f, f * 0.97, 0.4, 'sawtooth', 0.18, i * 0.22));
        break;
    }
  }
}

export const sfx = new Sfx();
