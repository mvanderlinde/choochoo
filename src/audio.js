const mix = (a, b, t) => a + (b - a) * t;

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
    try {
      this.pickVoices();
      speechSynthesis.addEventListener('voiceschanged', () => this.pickVoices()); // voices load late in some browsers
    } catch { /* speech not available */ }
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

  // One steam exhaust beat. fast: 0 (just starting) .. 1 (top speed); beat: 0..3 within each wheel turn.
  // A soft low "whump" of steam, a noise burst whose pitch sweeps down, and a little hiss on top.
  // Slow chuffs are long and breathy; at speed they get shorter so they run together.
  chuff(fast, beat) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const accent = [1, 0.62, 0.82, 0.58][beat % 4] * (0.9 + Math.random() * 0.2);
    const vol = (0.045 + 0.04 * fast) * accent;
    const len = mix(0.42, 0.13, fast);
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(vol, t + 0.015);
    out.gain.exponentialRampToValueAtTime(vol * 0.35, t + len * 0.35);
    out.gain.exponentialRampToValueAtTime(0.0001, t + len);
    out.connect(this.master);
    const burst = (filter, f0, f1, q, level) => {
      const n = ctx.createBufferSource(); n.buffer = this.noise;
      const f = ctx.createBiquadFilter(); f.type = filter; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + len);
      const g = ctx.createGain(); g.gain.value = level;
      n.connect(f).connect(g).connect(out);
      n.start(t, Math.random() * 0.45, len + 0.05);
    };
    burst('lowpass', 1500 + 600 * fast, 380, 0.6, 1.0); // the chuff itself
    burst('bandpass', 140, 90, 1.4, 3.0);              // body: the low "whump"
    burst('highpass', 4200, 3000, 0.5, 0.18);          // a touch of steam hiss
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

  // steady rain hiss, v = 0..1
  setRain(v) {
    if (!this.ctx) return;
    if (!this.rainGain) {
      const ctx = this.ctx;
      const n = ctx.createBufferSource(); n.buffer = this.noise; n.loop = true;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 7000;
      this.rainGain = ctx.createGain(); this.rainGain.gain.value = 0;
      n.connect(hp).connect(lp).connect(this.rainGain).connect(this.master);
      n.start();
    }
    this.rainGain.gain.setTargetAtTime(v * 0.1, this.ctx.currentTime, 0.3);
  }

  // Speech: the natural-sounding Google voices when online, otherwise the best voice installed
  // on this computer (Apple's downloadable Premium/Enhanced voices beat the old default ones).
  pickVoices() {
    const all = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    const find = (test) => all.find(test);
    const online = ['Google US English', 'Google UK English Female', 'Google UK English Male']
      .map((n) => find((v) => v.name === n)).filter(Boolean);
    const local = all.filter((v) => v.localService);
    const rank = (v) => /premium/i.test(v.name) ? 0 : /enhanced/i.test(v.name) ? 1
      : /^(Samantha|Ava|Zoe|Allison|Susan|Karen|Moira|Daniel|Tessa|Serena)\b/.test(v.name) ? 2 : 3;
    local.sort((a, b) => rank(a) - rank(b) || (b.lang === 'en-US') - (a.lang === 'en-US'));
    // skip the novelty voices (Bubbles, Zarvox, ...) unless they're all there is
    this.voices = { online, local: local.filter((v) => rank(v) < 3).concat(local.filter((v) => rank(v) === 3 && /\(/.test(v.name))) };
  }

  say(text) {
    try {
      if (!this.voices?.local.length && !this.voices?.online.length) this.pickVoices();
      const id = this.sayId = (this.sayId ?? 0) + 1;
      const speak = (voice, onFail) => {
        const u = new SpeechSynthesisUtterance(text);
        if (voice) { u.voice = voice; u.lang = voice.lang; }
        u.rate = 0.95;
        let started = false, failed = false;
        const fail = () => {
          if (started || failed || id !== this.sayId) return; // already talking, or a newer line took over
          failed = true; speechSynthesis.cancel(); onFail?.();
        };
        u.onstart = () => { started = true; };
        u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') fail(); };
        if (onFail) setTimeout(fail, 2500); // online voice didn't start (no internet?): use a local one
        speechSynthesis.speak(u);
      };
      speechSynthesis.cancel();
      const local = this.voices.local[0];
      const online = navigator.onLine ? this.voices.online[0] : null;
      if (online) speak(online, () => speak(local)); else speak(local);
    } catch { /* speech not available */ }
  }
}
