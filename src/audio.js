// All sounds are synthesized with the Web Audio API; no audio files needed.
export class Sound {
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.lastHorn = -9; this.lastDing = -9;
  }

  horn() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (t - this.lastHorn < 1.4) return; // stop mashing from being deafening
    this.lastHorn = t;
    this.blast(t, 0.32);
    this.blast(t + 0.45, 0.75);
  }

  blast(t, dur) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.22, t + 0.05);
    out.gain.setValueAtTime(0.22, t + dur);
    out.gain.linearRampToValueAtTime(0.0001, t + dur + 0.15);
    out.connect(this.master);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    lp.connect(out);
    for (const f of [370, 466, 554]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.96, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.08);
      const g = ctx.createGain(); g.gain.value = 0.33;
      o.connect(g).connect(lp);
      o.start(t); o.stop(t + dur + 0.2);
    }
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800;
    const ng = ctx.createGain(); ng.gain.value = 0.08;
    n.connect(bp).connect(ng).connect(out);
    n.start(t); n.stop(t + dur + 0.2);
  }

  chuff(vol) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t, Math.random() * 0.7, 0.2);
  }

  ding() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (t - this.lastDing < 0.25) return;
    this.lastDing = t;
    for (const [f, v] of [[1318, 0.15], [2637, 0.05]]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g).connect(this.master);
      o.start(t); o.stop(t + 1.25);
    }
  }

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.06);
  }

  tone(f, start, dur, vol, type = 'sine') {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g).connect(this.master);
    o.start(start); o.stop(start + dur + 0.05);
  }

  // "ding-dong" station announcement chime
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(784, t, 0.9, 0.18);
    this.tone(622, t + 0.45, 1.2, 0.18);
  }

  // cheerful blip when someone gets on or off
  pop() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, f = 600 + Math.random() * 400;
    this.tone(f, t, 0.12, 0.12, 'triangle');
    this.tone(f * 1.5, t + 0.07, 0.15, 0.1, 'triangle');
  }

  // level crossing bell, quieter the further away it is
  bell(vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(1180, t, 0.35, 0.09 * vol, 'triangle');
    this.tone(2950, t, 0.2, 0.03 * vol);
  }

  // cartoon splat when the train squashes a car
  squish() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = ctx.createBufferSource(); n.buffer = this.noise;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2500, t); lp.frequency.exponentialRampToValueAtTime(150, t + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    n.connect(lp).connect(g).connect(this.master);
    n.start(t, 0, 0.45);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(320, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.35);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.45);
  }

  // springy "boing" when a squashed car pops back up
  boing() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(520, t + 0.25);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 18;
    const lg = ctx.createGain(); lg.gain.value = 40;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g).connect(this.master);
    o.start(t); lfo.start(t); o.stop(t + 0.6); lfo.stop(t + 0.6);
  }

  // little car horn "beep beep"
  beep() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const s of [0, 0.22]) { this.tone(440, t + s, 0.15, 0.06, 'square'); this.tone(554, t + s, 0.15, 0.05, 'square'); }
  }

  say(text) {
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.95; u.pitch = 1.2;
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    } catch { /* speech not available */ }
  }
}
