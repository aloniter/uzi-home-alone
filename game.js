/* Uzi Is Home Alone: a 40-second canvas game for phone browsers, built from the art pack.
   The room is a 720x1280 (9:16) stage and every world position below is in that space. The canvas fills the
   phone screen: taller screens see extra wall and floor (mirrored strips of the room), shorter ones lose a little
   wall at the top. `view` holds the visible part of the stage; HUD and buttons hang from its edges. */
(() => {
  'use strict';

  // ---------- constants ----------
  const W = 720, H = 1280;
  const QS = location.search || '';
  const DEBUG = /[?&]debug\b/.test(QS);
  const GALLERY = /[?&]gallery\b/.test(QS);
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const ROUND_TIME = 40;
  const ZOOMIES_TIME = 6;
  const METER_TREATS = 12, METER_STEP = 5;   // treats for the 1st Zoomies, +5 for each one after
  const FINGER_LIFT = 105;         // Uzi runs this far above a touching finger, so he and the treats stay visible
  const MIN_VIEW_H = 1180, MAX_VIEW_H = 1700;
  const ASSET_BASE = 'assets/', ASSET_V = window.__UZI_V ? '?v=' + window.__UZI_V : '';
  const DOG_SCALE = 0.53;          // runtime pose canvas (640px) to stage px at depth 1
  const SPEED = 560, ZOOM_SPEED = 960;

  const FONT = '"Fredoka", "Baloo 2", "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif';
  const C = {
    ink: '#4a3428', choc: '#5B392D', cream: '#F2E4CD', creamHi: '#FFF8EC', sage: '#81988A', sageDark: '#4E6356',
    coral: '#DC846C', gold: '#F6A22E', goldHi: '#FFD67A'
  };

  // Uzi's ground point stays inside FIELD so his whole body stays on screen.
  const FIELD = { x0: 150, x1: 570, y0: 640, y1: 1150 };
  const ITEM = { x0: 105, x1: 615, y0: 668, y1: 1140 };
  const VACF = { x0: 95, x1: 625, y0: 660, y1: 1150 };
  const LAP = { x: 360, y: 900, rx: 205, ry: 195 };
  const MOUTH = { dx: 50, rx: 128, ry: 70 };   // pickup zone from chest to nose, at depth 1

  const FILES = {
    room: 'environment/living-room-clean.webp', chaos: 'environment/living-room-chaotic.webp', finale: 'finale/finale.webp',
    idle: 'character/poses/uzi-idle.webp', running: 'character/poses/uzi-running.webp', jumping: 'character/poses/uzi-jumping.webp',
    searching: 'character/poses/uzi-searching.webp', mischievous: 'character/poses/uzi-mischievous.webp',
    guilty: 'character/poses/uzi-guilty.webp', zoomies: 'character/poses/uzi-zoomies.webp',
    treat: 'props/sweet-potato-treat.webp', vacuum: 'props/robot-vacuum.webp', pillow: 'props/sofa-pillow.webp',
    sock: 'props/sock.webp', plant: 'props/potted-plant.webp',
    burst: 'effects/paw-collect-burst.webp', trail: 'effects/zoomies-trail.webp',
    play: 'ui/play-icon.webp', replay: 'ui/replay-icon.webp', panel: 'ui/score-panel-frame.webp',
    icon: 'ui/sweet-potato-icon.webp', meter: 'ui/zoomies-meter-frame.webp'
  };

  // Alpha bounds [x, y, w, h] of each runtime image (from ASSET_DATA.json). The foot anchor is the bottom centre of
  // the bounds; mouth is a normalised point on the image canvas used to hold the sock.
  const POSE = {
    idle:        { b: [18, 17, 598, 607],  mouth: [0.815, 0.35] },
    running:     { b: [30, 40, 582, 512],  mouth: [0.835, 0.35] },
    jumping:     { b: [33, 42, 574, 480],  mouth: [0.785, 0.35] },
    searching:   { b: [30, 103, 563, 451], mouth: [0.83, 0.75] },
    mischievous: { b: [44, 77, 553, 490],  mouth: [0.79, 0.49] },
    guilty:      { b: [110, 20, 418, 601], mouth: [0.655, 0.39] },
    zoomies:     { b: [23, 48, 595, 456],  mouth: [0.85, 0.345] }
  };
  const PROP = {
    treat: [35, 64, 249, 185], vacuum: [34, 77, 252, 180], pillow: [27, 43, 262, 240], sock: [50, 54, 218, 216],
    plant: [56, 30, 203, 258], burst: [65, 60, 381, 377], trail: [44, 220, 440, 108], icon: [35, 64, 249, 185],
    play: [13, 9, 293, 302], replay: [12, 8, 296, 304], panel: [9, 28, 462, 104], meter: [10, 12, 619, 135]
  };

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const hyp = Math.hypot;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInCubic = t => t * t * t;
  const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); };
  const depth = y => 0.80 + 0.36 * clamp((y - FIELD.y0) / (FIELD.y1 - FIELD.y0), -0.15, 1.15);
  const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));

  // ---------- canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const stageEl = document.getElementById('stage');
  const frameEl = document.getElementById('frame');
  const probeEl = document.getElementById('safe-probe');
  let K = 1;
  // Visible part of the stage, in stage units. top < 0 means extra wall above the room; top > 0 means cropped.
  const view = { top: 0, bottom: H, h: H, safeT: 0, safeB: 0, hudY: 0, floorY: H, u: 1 };
  function resize() {
    const aw = Math.max(1, stageEl.clientWidth), ah = Math.max(1, stageEl.clientHeight);
    const r = ah / aw;
    let cw = aw, ch = ah, vh;
    if (r >= H / W) { vh = Math.min(W * r, MAX_VIEW_H); ch = Math.min(ah, vh * aw / W); }   // tall phone: more wall and floor
    else if (r >= MIN_VIEW_H / W) vh = W * r;                                             // a bit short: crop the wall
    else { vh = H; cw = ah * W / H; }                                                     // wide window: whole room, centred
    cw = Math.floor(cw); ch = Math.floor(ch);
    frameEl.style.width = cw + 'px';
    frameEl.style.height = ch + 'px';
    frameEl.classList.toggle('boxed', cw < aw - 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.max(1, Math.round(cw * dpr)), ph = Math.max(1, Math.round(ch * dpr));
    if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
    K = canvas.width / W;
    view.u = cw / W;
    view.h = vh;
    view.top = vh >= H ? -Math.round((vh - H) * 0.4) : H - vh;
    view.bottom = view.top + vh;
    // notch and home-indicator insets only matter when the game touches the screen edges
    let st = 0, sb = 0;
    if (probeEl && cw >= aw - 2) {
      const cs = getComputedStyle(probeEl);
      st = parseFloat(cs.paddingTop) || 0; sb = parseFloat(cs.paddingBottom) || 0;
    }
    view.safeT = st / view.u;
    view.safeB = sb / view.u;
    view.hudY = view.top + view.safeT;
    view.floorY = view.bottom - view.safeB;
    frameEl.style.setProperty('--u', view.u + 'px');
    frameEl.style.setProperty('--hud', ((view.hudY - view.top) * view.u) + 'px');
    frameEl.style.setProperty('--sb', sb + 'px');
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 120));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(stageEl);
  resize();

  function makeRadial(size, stops) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr;
    g.fillRect(0, 0, size, size);
    return c;
  }
  const SHADOW = makeRadial(128, [[0, 'rgba(78,44,22,0.62)'], [0.5, 'rgba(78,44,22,0.32)'], [1, 'rgba(78,44,22,0)']]);
  const GLOW = makeRadial(128, [[0, 'rgba(255,205,100,0.95)'], [0.38, 'rgba(255,170,60,0.4)'], [1, 'rgba(255,150,40,0)']]);
  const VIGNETTE = (() => {
    const c = document.createElement('canvas');
    c.width = 180; c.height = 320;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(90, 170, 60, 90, 170, 200);
    gr.addColorStop(0, 'rgba(255,190,80,0)');
    gr.addColorStop(0.65, 'rgba(255,180,60,0.18)');
    gr.addColorStop(1, 'rgba(246,140,30,0.62)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 180, 320);
    return c;
  })();

  // ---------- assets ----------
  const IMG = {};
  const loadState = { done: 0, total: Object.keys(FILES).length };
  function loadOne(key, file, tries) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.decoding = 'async';
      im.onload = () => { IMG[key] = im; loadState.done++; resolve(); };
      im.onerror = () => {
        // one retry: phones on weak mobile data drop the odd request
        if (tries > 0) setTimeout(() => loadOne(key, file, tries - 1).then(resolve, reject), 500);
        else reject(new Error('Could not load ' + file));
      };
      im.src = ASSET_BASE + file + ASSET_V;
    });
  }
  function loadAll() {
    return Promise.all(Object.entries(FILES).map(([key, file]) => loadOne(key, file, 1)));
  }

  // The meter frame's opening is transparent; measure it from the alpha so the fill sits exactly behind it.
  let HOLE = { x0: 0.07, x1: 0.93, y0: 0.27, y1: 0.73 };
  function measureMeterHole() {
    try {
      const im = IMG.meter, w = im.naturalWidth, h = im.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, w, h).data;
      const a = (x, y) => d[(y * w + x) * 4 + 3];
      const cy = h >> 1, cx = w >> 1;
      if (a(cx, cy) > 40) return;
      let x0 = cx; while (x0 > 0 && a(x0 - 1, cy) < 40) x0--;
      let x1 = cx; while (x1 < w - 1 && a(x1 + 1, cy) < 40) x1++;
      let y0 = cy; while (y0 > 0 && a(cx, y0 - 1) < 40) y0--;
      let y1 = cy; while (y1 < h - 1 && a(cx, y1 + 1) < 40) y1++;
      if (x1 - x0 > w * 0.4) HOLE = { x0: x0 / w, x1: (x1 + 1) / w, y0: y0 / h, y1: (y1 + 1) / h };
    } catch (e) { /* keep the default opening */ }
  }

  // ---------- sound (Web Audio synthesis, no files) ----------
  const Sound = (() => {
    let ac = null, master = null, sfx = null, mus = null, noiseBuf = null;
    let muted = false;
    try { muted = localStorage.getItem('uzi-muted') === '1'; } catch (e) { muted = false; }
    let hum = null, musicOn = false, tempo = 112, nextT = 0, step = 0, timer = null;
    const midi = m => 440 * Math.pow(2, (m - 69) / 12);
    const now = () => (ac ? ac.currentTime : 0);

    function init() {
      if (ac) { if (ac.state === 'suspended') ac.resume().catch(() => {}); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { ac = new AC(); } catch (e) { ac = null; return; }
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.85; master.connect(ac.destination);
      sfx = ac.createGain(); sfx.gain.value = 1; sfx.connect(master);
      mus = ac.createGain(); mus.gain.value = 0.5; mus.connect(master);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    function tone(f, dur, o = {}) {
      if (!ac) return;
      const t0 = now() + (o.delay || 0);
      const osc = ac.createOscillator(), g = ac.createGain();
      osc.type = o.type || 'triangle';
      osc.frequency.setValueAtTime(f, t0);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + (o.glide || dur));
      const v = o.vol == null ? 0.15 : o.vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.006));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g); g.connect(o.dest || sfx);
      osc.start(t0); osc.stop(t0 + dur + 0.03);
    }
    function noise(dur, o = {}) {
      if (!ac) return;
      const t0 = now() + (o.delay || 0);
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const fl = ac.createBiquadFilter();
      fl.type = o.type || 'lowpass';
      fl.Q.value = o.q || 0.7;
      fl.frequency.setValueAtTime(o.f || 1200, t0);
      if (o.to) fl.frequency.exponentialRampToValueAtTime(o.to, t0 + dur);
      const g = ac.createGain();
      const v = o.vol == null ? 0.15 : o.vol;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack || 0.01));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(fl); fl.connect(g); g.connect(o.dest || sfx);
      src.start(t0, Math.random() * 0.5); src.stop(t0 + dur + 0.03);
    }

    // A cheerful pentatonic loop: 4 bars of eighth notes over C, A, F, G.
    const MEL = [72, 0, 76, 79, 81, 79, 76, 0, 74, 0, 76, 74, 72, 0, 69, 0, 69, 72, 74, 76, 79, 0, 76, 74, 74, 76, 74, 72, 67, 0, 72, 0];
    const ROOT = [48, 45, 41, 43];
    function schedule() {
      if (!ac || !musicOn) return;
      while (nextT < now() + 0.15) {
        const e8 = 60 / tempo / 2;
        const bar = (step >> 3) & 3, s8 = step & 7, root = ROOT[bar], mel = MEL[step % 32];
        const t = Math.max(0, nextT - now());
        if (mel) tone(midi(mel), e8 * 1.6, { type: 'triangle', vol: 0.07, delay: t, dest: mus });
        if (s8 === 0 || s8 === 4) {
          tone(midi(root + (s8 === 4 ? 7 : 0)), e8 * 1.8, { type: 'triangle', vol: 0.11, delay: t, dest: mus });
          tone(110, 0.12, { type: 'sine', vol: 0.1, to: 45, delay: t, dest: mus });
        }
        if (s8 === 2 || s8 === 6) tone(midi(root + 12), e8 * 0.9, { type: 'triangle', vol: 0.045, delay: t, dest: mus });
        if (s8 % 2 === 1) noise(0.04, { type: 'highpass', f: 6000, vol: 0.022, delay: t, dest: mus });
        nextT += e8;
        step++;
      }
    }
    const PENTA = [0, 2, 4, 7, 9, 12, 14, 16];
    return {
      init,
      get muted() { return muted; },
      toggleMute() {
        muted = !muted;
        try { localStorage.setItem('uzi-muted', muted ? '1' : '0'); } catch (e) { /* per-viewer convenience only */ }
        if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.02);
      },
      wake() { if (ac && ac.state !== 'running') this.suspend(false); },
      suspend(on) {
        if (!ac) return;
        try { const p = on ? ac.suspend() : ac.resume(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* closed context */ }
        // notes queued while the page was hidden would all play at once on return
        if (!on && musicOn) nextT = now() + 0.08;
      },
      pickup(i) {
        const m = 79 + PENTA[Math.min(i, PENTA.length - 1)];
        tone(midi(m), 0.16, { type: 'triangle', vol: 0.16 });
        tone(midi(m + 12), 0.12, { type: 'sine', vol: 0.07, delay: 0.035 });
      },
      squeak() {
        tone(520, 0.13, { type: 'square', vol: 0.05, to: 1250 });
        tone(1250, 0.12, { type: 'square', vol: 0.04, to: 820, delay: 0.12 });
        tone(midi(84), 0.2, { type: 'triangle', vol: 0.1, delay: 0.05 });
      },
      thump() { noise(0.2, { f: 900, to: 160, vol: 0.32 }); tone(150, 0.16, { type: 'sine', vol: 0.25, to: 70 }); },
      softThump() { noise(0.1, { f: 600, to: 150, vol: 0.1 }); },
      oops() {
        tone(440, 0.32, { type: 'triangle', vol: 0.16, to: 190 });
        noise(0.12, { f: 2000, to: 400, vol: 0.12 });
        tone(330, 0.3, { type: 'sine', vol: 0.08, to: 150, delay: 0.12 });
      },
      bonk() {
        tone(200, 0.28, { type: 'sine', vol: 0.3, to: 520, glide: 0.1 });
        tone(140, 0.2, { type: 'triangle', vol: 0.18, to: 60, delay: 0.02 });
        noise(0.08, { f: 3000, vol: 0.12, type: 'highpass' });
      },
      zoomies() {
        noise(0.7, { type: 'bandpass', f: 300, to: 3200, q: 1.2, vol: 0.22 });
        [72, 76, 79, 84, 88].forEach((m, i) => tone(midi(m), 0.18, { type: 'square', vol: 0.05, delay: 0.05 * i }));
      },
      tick() { tone(1400, 0.05, { type: 'square', vol: 0.05 }); },
      whoosh() { noise(0.55, { type: 'bandpass', f: 500, to: 2600, q: 0.9, vol: 0.28 }); },
      boing() { tone(180, 0.45, { type: 'sine', vol: 0.3, to: 420, glide: 0.12 }); },
      fanfare() {
        [72, 76, 79, 84].forEach((m, i) => tone(midi(m), 0.3, { type: 'triangle', vol: 0.14, delay: 0.1 * i }));
        [72, 76, 79].forEach(m => tone(midi(m), 0.9, { type: 'triangle', vol: 0.08, delay: 0.42 }));
        tone(midi(96), 0.6, { type: 'sine', vol: 0.05, delay: 0.42 });
      },
      slurp() { tone(700, 0.18, { type: 'sawtooth', vol: 0.03, to: 200 }); },
      rustle() { noise(0.25, { type: 'highpass', f: 2500, vol: 0.08 }); },
      startHum() {
        if (!ac || hum) return;
        const o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
        o.type = 'sawtooth'; o.frequency.value = 92;
        f.type = 'lowpass'; f.frequency.value = 380;
        g.gain.value = 0;
        o.connect(f); f.connect(g); g.connect(sfx);
        o.start();
        hum = { o, g };
      },
      stopHum() {
        if (!hum) return;
        const h = hum; hum = null;
        h.g.gain.setTargetAtTime(0, now(), 0.05);
        h.o.stop(now() + 0.4);
      },
      setHum(level) { if (hum) hum.g.gain.setTargetAtTime(level, now(), 0.08); },
      setTempo(t) { tempo = t; },
      startMusic() {
        if (!ac || musicOn) return;
        musicOn = true; step = 0; nextT = now() + 0.08;
        timer = setInterval(schedule, 30);
      },
      stopMusic() { musicOn = false; if (timer) clearInterval(timer); timer = null; }
    };
  })();

  // ---------- state ----------
  let state = 'loading', loadError = '';
  let clock = 0, playT = 0, timeLeft = ROUND_TIME, paused = false, held = false;
  let score = 0, meter = 0, meterVis = 0, combo = 0, lastPickup = -9, spawnCd = 0, lastTick = 99;
  const stats = { treats: 0, pillows: 0, socks: 0, bonks: 0, oops: 0 };
  const zoom = { t: 0, lapping: false, lapA: 0, dir: 1, count: 0 };
  let treats = [], pillows = [], particles = [], texts = [], bursts = [], flyers = [], banners = [], trail = [];
  const dog = {}, vac = {}, sock = {}, plant = {};
  const shake = { t: 0, dur: 1, mag: 0 };
  const hud = { scorePop: 0, timerPulse: 0, meterPulse: 0 };
  const hint = { t: 0 };
  const fin = { t: 0 };
  const res = { t: 0 };
  const input = { down: false, pid: null, x: 0, y: 0, has: false, everMoved: false, keys: {}, touched: false, lift: 0, px: 0, py: 0, snap: null };
  const tip = { txt: '', t: 9, dur: 0 };
  const RANKS = [45, 110, 180, 250, 330];   // score cut-offs for the result titles
  const seen = { treat: false, zoom: false, rounds: 0 };
  let best = 0, newBest = false;
  try { best = parseInt(localStorage.getItem('uzi-best'), 10) || 0; } catch (e) { best = 0; }
  // a shared link can carry the sender's score (?s=123) as a friendly dare
  const dare = (() => { const m = /[?&]s=(\d{1,4})\b/.exec(QS); return m ? parseInt(m[1], 10) : 0; })();

  function resetWorld() {
    Object.assign(dog, {
      x: 330, y: 900, vx: 0, vy: 0, speed: 0, face: 1, faceVis: 1, pose: 'idle', poseT: 0, pop: 0, stun: 0, invuln: 0,
      hop: 0, hopDur: 0.38, carry: false, phase: 0, z: 0, rot: 0, sx: 1, sy: 1, alpha: 1, finScale: 1, dustT: 0
    });
    Object.assign(vac, {
      x: 150, y: 835, vx: 0, vy: 0, z: 0, vz: 0, ang: 0, sp: 0, mode: 'wander', modeT: 2.2, tx: 300, ty: 760,
      pause: 1.2, bonk: 0, spin: 0, spinV: 0, frozen: false, eatCd: 0
    });
    Object.assign(sock, { x: 600, y: 905, z: 0, vx: 0, vy: 0, vz: 0, rot: -1.25, vrot: 0, state: 'floor', cd: 0, carryT: 0 });
    Object.assign(plant, { x: 92, y: 1152, a: 0, va: 0, cd: 0, hit: false });
    pillows = [[220, 702, -0.18], [545, 742, 0.22], [285, 1108, -0.08]].map(([x, y, r]) => ({
      x, y, z: 0, vx: 0, vy: 0, vz: 0, rot: r, rest: r, vrot: 0, cd: 0, hits: 0, lastScore: -9
    }));
    treats = [];
    for (let i = 0; i < 5; i++) treats.push(makeTreat(392 + i * 54, 985 + i * 22, i * 0.08));
    spawnTrail(5);
    particles = []; texts = []; bursts = []; flyers = []; banners = []; trail = [];
    score = 0; meter = 0; meterVis = 0; combo = 0; lastPickup = -9; spawnCd = 0; lastTick = 99;
    Object.keys(stats).forEach(k => { stats[k] = 0; });
    zoom.t = 0; zoom.lapping = false; zoom.count = 0;
    playT = 0; timeLeft = ROUND_TIME;
    fin.t = 0; fin.leap = false; fin.hit = false; fin.propAlpha = 1; fin.chaos = 0;
    res.t = 0;
    hint.t = 0;
    input.has = false; input.down = false; input.everMoved = false; input.snap = null;
    tip.t = 9; tip.dur = 0;
  }

  function makeTreat(x, y, delay) {
    return { x, y, born: clock + delay, appear: 0, phase: rand(0, 6.28), state: 'live', eatT: 0, rot: rand(-0.25, 0.25), ex: 0, ey: 0 };
  }

  function spawnTrail(n) {
    for (let tries = 0; tries < 40; tries++) {
      let x = rand(ITEM.x0 + 20, ITEM.x1 - 20), y = rand(ITEM.y0 + 10, ITEM.y1 - 10);
      let ang = rand(0, Math.PI * 2);
      const bend = rand(-0.28, 0.28);
      const pts = [];
      let ok = true;
      for (let i = 0; i < n && ok; i++) {
        if (i > 0) { ang += bend; x += Math.cos(ang) * 92; y += Math.sin(ang) * 56; }
        if (x < ITEM.x0 || x > ITEM.x1 || y < ITEM.y0 || y > ITEM.y1) ok = false;
        else if (hyp(x - dog.x, (y - dog.y) * 1.3) < 170) ok = false;
        else if (hyp(x - vac.x, y - vac.y) < 110) ok = false;
        else {
          for (const t of treats) if (t.state === 'live' && hyp(t.x - x, t.y - y) < 80) { ok = false; break; }
          for (const p of pillows) if (hyp(p.x - x, p.y - y) < 60) { ok = false; break; }
        }
        if (ok) pts.push([x, y]);
      }
      if (ok) { pts.forEach(([px, py], i) => treats.push(makeTreat(px, py, i * 0.08))); return true; }
    }
    return false;
  }

  // ---------- flow ----------
  function startGame() {
    clearTimeout(toastTimer); ui.toast.classList.remove('show');
    resetWorld();
    state = 'play';
    held = false;
    Sound.init();
    Sound.setTempo(112);
    Sound.startMusic();
    Sound.startHum();
    vac.pause = 0.8;
  }

  function startFinale() {
    state = 'finale';
    fin.t = 0;
    input.down = false;
    if (zoom.t > 0) { zoom.t = 0; trail = []; }
    Sound.stopMusic();
    Sound.stopHum();
    if (dog.carry) flingSock();
  }

  // ---------- events and feedback ----------
  function addShake(mag, dur) { if (REDUCED) return; shake.mag = mag; shake.dur = dur; shake.t = dur; }
  function addText(txt, x, y, o = {}) { texts.push({ txt, x, y, t: 0, life: o.life || 0.9, size: o.size || 40, fill: o.fill || C.creamHi, stroke: o.stroke || C.choc }); }
  function banner(txt, fill, size) { banners.push({ txt, fill: fill || C.goldHi, size: size || 104, t: 0, dur: 1.3, y: 470 }); }
  // haptics only for touch players, and only after a real touch (browsers block it otherwise)
  function vibrate(ms) { try { if (input.touched && navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* not supported */ } }
  function sparks(x, y, n, o = {}) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), sp = rand(o.min || 80, o.max || 260);
      particles.push({ kind: o.kind || 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 - (o.up || 60), g: o.g == null ? 300 : o.g,
        t: 0, life: rand(0.4, 0.8), size: rand(o.s0 || 6, o.s1 || 12), rot: rand(0, 6), vr: rand(-6, 6), color: o.color });
    }
  }
  function fluff(x, y, n) { sparks(x, y, n, { kind: 'fluff', min: 40, max: 160, g: -20, s0: 6, s1: 13, up: 40 }); }

  function collectTreat(t) {
    t.state = 'dead';
    const zoomOn = zoom.t > 0;
    const pts = zoomOn ? 2 : 1;
    score += pts;
    stats.treats++;
    combo = clock - lastPickup < 0.9 ? combo + 1 : 0;
    lastPickup = clock;
    const s = depth(t.y);
    bursts.push({ x: t.x, y: t.y - 30 * s, t: 0, s });
    flyers.push({ x0: t.x, y0: t.y - 30 * s, t: 0, dur: 0.5 });
    addText('+' + pts, t.x, t.y - 90 * s, { size: 42, fill: C.goldHi });
    sparks(t.x, t.y - 25 * s, 6, { color: C.goldHi });
    Sound.pickup(combo);
    if (!zoomOn) {
      if (!seen.treat) { seen.treat = true; showTip('Treats fill the Zoomies bar!', 2.8); }
      // a slow start gets a quiet helping hand, so every player sees the Zoomies at least once
      const help = zoom.count === 0 && playT > 12 ? 1.6 : 1;
      meter = Math.min(1, meter + help / (METER_TREATS + METER_STEP * zoom.count));
      if (meter >= 0.999) startZoomies();
    }
  }

  function startZoomies() {
    zoom.t = ZOOMIES_TIME;
    zoom.count++;
    zoom.lapping = false;
    meter = 0;
    hud.meterPulse = 1;
    banner('ZOOMIES!', C.goldHi, 118);
    if (!seen.zoom) { seen.zoom = true; showTip('Double points! Bonk the vacuum!', 3.2); }
    Sound.zoomies();
    Sound.setTempo(150);
    addShake(10, 0.35);
    vibrate(30);
    sparks(dog.x, dog.y - 100, 20, { color: C.goldHi, min: 150, max: 420 });
    if (dog.carry) flingSock();
    for (const p of pillows) if (hyp(p.x - dog.x, p.y - dog.y) < 240 && p.z < 30) knockPillow(p, true);
  }

  function endZoomies() {
    zoom.t = 0;
    trail = [];
    Sound.setTempo(112);
    addText('phew!', dog.x, dog.y - 300 * depth(dog.y), { size: 38, fill: C.creamHi });
  }

  function grabSock() {
    dog.carry = true;
    sock.state = 'carried';
    sock.carryT = 0;
    const pts = stats.socks === 0 ? 5 : 3;
    score += pts;
    stats.socks++;
    dog.hop = dog.hopDur = 0.38;
    const s = depth(dog.y);
    addText(`+${pts} SOCK!`, dog.x, dog.y - 300 * s, { size: 44, fill: C.creamHi, stroke: C.coral });
    sparks(sock.x, sock.y - 30, 8, { color: '#ffffff' });
    Sound.squeak();
  }

  function flingSock() {
    const m = dogMouth();
    dog.carry = false;
    sock.state = 'flying';
    sock.x = clamp(m.x, ITEM.x0, ITEM.x1);
    sock.y = clamp(dog.y + rand(-20, 20), ITEM.y0, ITEM.y1);
    sock.z = Math.max(20, dog.y - m.y);
    sock.vx = dog.face * rand(250, 420) + dog.vx * 0.3;
    sock.vy = rand(-140, 140);
    sock.vz = 620;
    sock.vrot = dog.face * rand(8, 12);
    sock.cd = 1.1;
  }

  function knockPillow(p, big) {
    const zoomOn = zoom.t > 0 || big;
    let dx = p.x - dog.x + dog.vx * 0.12, dy = (p.y - dog.y) * 1.6 + dog.vy * 0.12;
    const d = hyp(dx, dy) || 1;
    const sp = (380 + 0.45 * dog.speed) * (zoomOn ? 1.3 : 1);
    p.vx = dx / d * sp;
    p.vy = dy / d * sp * 0.6;
    p.vz = zoomOn ? 780 : 560;
    p.vrot = (dx >= 0 ? 1 : -1) * rand(7, 11);
    p.cd = 0.5;
    // the first knock of each pillow is worth 2; later knocks only score once the pillow has rested a while
    const pts = p.hits === 0 ? 2 : clock - p.lastScore > 2.5 ? 1 : 0;
    p.hits++;
    stats.pillows++;
    const s = depth(p.y);
    if (pts) { score += pts; p.lastScore = clock; addText('+' + pts, p.x, p.y - 140 * s, { size: 40, fill: C.creamHi, stroke: C.coral }); }
    fluff(p.x, p.y - 50 * s, 9);
    Sound.thump();
  }

  function hitByVacuum() {
    dog.stun = 0.7;
    dog.invuln = 2.0;
    const dx = dog.x - vac.x, dy = dog.y - vac.y, d = hyp(dx, dy) || 1;
    dog.vx = dx / d * 420;
    dog.vy = dy / d * 300;
    meter = Math.max(0, meter - (zoom.count === 0 ? 0.06 : 0.12));
    stats.oops++;
    vac.pause = 0.8;
    vac.ang += Math.PI;
    if (dog.carry) flingSock();
    addText('Oops!', dog.x, dog.y - 300 * depth(dog.y), { size: 48, fill: C.creamHi, stroke: C.coral });
    Sound.oops();
    addShake(9, 0.3);
    vibrate(45);
  }

  function bonkVacuum() {
    vac.bonk = 1.3;
    const dx = vac.x - dog.x, dy = vac.y - dog.y, d = hyp(dx, dy) || 1;
    vac.vx = dx / d * 520 + dog.vx * 0.3;
    vac.vy = dy / d * 360 + dog.vy * 0.2;
    vac.vz = 520;
    vac.z = 1;
    vac.spinV = 16 * (dx >= 0 ? 1 : -1);
    score += 3;
    stats.bonks++;
    addText('+3 BONK!', vac.x, vac.y - 150, { size: 46, fill: C.goldHi });
    Sound.bonk();
    addShake(8, 0.25);
    sparks(vac.x, vac.y - 60, 10, { kind: 'star', color: C.goldHi, min: 120, max: 300 });
  }

  // ---------- input ----------
  const $ = id => document.getElementById(id);
  const ui = { play: $('btn-play'), results: $('results-ui'), again: $('btn-again'), share: $('btn-share'), mute: $('btn-mute'),
    pause: $('pause'), toast: $('toast'), rotate: $('rotate') };
  const COARSE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  function toStage(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width * W, y: view.top + (e.clientY - r.top) / r.height * view.h };
  }

  // A tap right on a treat or the sock sends Uzi straight to it, until the finger starts dragging.
  function pickSnap(p) {
    let found = null, bd = 72;
    for (const t of treats) if (t.state === 'live' && t.appear >= 1) { const d = hyp(t.x - p.x, t.y - 20 - p.y); if (d < bd) { bd = d; found = t; } }
    if (sock.state === 'floor' && hyp(sock.x - p.x, sock.y - 20 - p.y) < bd) found = sock;
    return found ? { item: found, fx: p.x, fy: p.y } : null;
  }

  // Turns a pointer position into the spot Uzi runs to. With a finger he runs a little above it, and the offset is
  // stretched near the bottom so the finger never has to leave the screen to reach the front of the room.
  function aim(p) {
    input.px = p.x; input.py = p.y;
    let tx = p.x, ty = p.y;
    const o = input.snap;
    if (o && (hyp(p.x - o.fx, p.y - o.fy) > 28 || (o.item.state !== 'live' && o.item.state !== 'floor'))) input.snap = null;
    if (input.snap) { tx = input.snap.item.x; ty = input.snap.item.y; }
    else if (input.lift > 0) {
      const top = FIELD.y0 + input.lift, span = Math.max(160, view.floorY - 24 - top);
      ty = FIELD.y0 + (p.y - top) * Math.max(1, (FIELD.y1 - FIELD.y0) / span);
    }
    input.x = tx; input.y = ty; input.has = true; input.everMoved = true;
  }

  function pressAt(p, lift, pid) {
    if (state !== 'play' || held) return false;
    input.down = true;
    input.pid = pid;
    input.lift = lift;
    input.snap = lift ? pickSnap(p) : null;
    aim(p);
    return true;
  }

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (e.pointerType === 'touch' && e.isTrusted) input.touched = true;
    if (!pressAt(toStage(e), e.pointerType === 'mouse' ? 0 : FINGER_LIFT, e.pointerId)) return;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional */ }
  });
  canvas.addEventListener('pointermove', e => {
    if (!input.down || e.pointerId !== input.pid || state !== 'play') return;
    aim(toStage(e));
  });
  // the browser can take a touch away at any time (system gesture, incoming call, second finger)
  const release = e => { if (e.pointerId === input.pid) { input.down = false; input.pid = null; } };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('lostpointercapture', release);
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('click', () => {
    if (state === 'title') startGame();
    else if (state === 'error') location.reload();
  });
  // no page scroll, pull-to-refresh, pinch or double-tap zoom while playing
  document.addEventListener('touchmove', e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'dblclick'].forEach(n => document.addEventListener(n, e => e.preventDefault()));
  // audio may only start, or come back after an interruption, inside a user gesture
  ['pointerup', 'touchend', 'keydown'].forEach(n => document.addEventListener(n, () => { if (!held && !paused) Sound.wake(); }));

  function setMuteUi() {
    ui.mute.setAttribute('aria-pressed', Sound.muted ? 'true' : 'false');
    ui.mute.setAttribute('aria-label', Sound.muted ? 'Turn sound on' : 'Turn sound off');
  }
  function toggleMute() { Sound.init(); Sound.toggleMute(); setMuteUi(); }

  function pauseGame() {
    if (state !== 'play' || held) return;
    held = true;
    input.down = false; input.keys = {};
    Sound.suspend(true);
  }
  function resumeGame() {
    if (!held) return;
    held = false;
    last = performance.now();
    Sound.init();
    Sound.suspend(false);
  }
  function onHide() { paused = true; if (state === 'play') pauseGame(); else Sound.suspend(true); }
  function onShow() { paused = false; last = performance.now(); if (!held) Sound.suspend(false); }
  document.addEventListener('visibilitychange', () => (document.hidden ? onHide() : onShow()));
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', () => { if (!document.hidden) onShow(); });
  window.addEventListener('blur', () => { input.keys = {}; input.down = false; });
  // a phone turned sideways shows the "turn your phone" card: hold the round meanwhile
  window.addEventListener('resize', () => { if (ui.rotate && getComputedStyle(ui.rotate).display !== 'none') pauseGame(); });

  const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down' };
  window.addEventListener('keydown', e => {
    if (KEYMAP[e.code]) { input.keys[KEYMAP[e.code]] = true; input.everMoved = true; e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'Enter') {
      if (held) { resumeGame(); e.preventDefault(); }
      else if (state === 'title' || (state === 'results' && res.t > 0.6)) { startGame(); e.preventDefault(); }
    }
    if (e.code === 'KeyM') toggleMute();
    if (e.code === 'KeyP' || e.code === 'Escape') { if (held) resumeGame(); else pauseGame(); }
  });
  window.addEventListener('keyup', e => { if (KEYMAP[e.code]) input.keys[KEYMAP[e.code]] = false; });

  ui.play.addEventListener('click', () => { if (state === 'title') startGame(); });
  ui.again.addEventListener('click', () => { if (state === 'results') startGame(); });
  ui.share.addEventListener('click', () => share());
  ui.mute.addEventListener('click', toggleMute);
  ui.pause.addEventListener('click', resumeGame);

  // ---------- sharing ----------
  let toastTimer = 0, lastShare = null;
  function toast(msg, ms) {
    ui.toast.textContent = msg;
    ui.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove('show'), ms || 2400);
  }
  function shareData() {
    // the build writes the public address into <link rel="canonical">; without it, share the address in the bar
    const link = document.querySelector('link[rel="canonical"]');
    const base = (link && link.href) || (location.origin + location.pathname);
    return {
      title: 'Uzi Is Home Alone',
      text: `Uzi was home alone and scored ${score}. Today's title: ${rating().name} \u{1F436} Can you beat that?`,
      url: base + '?s=' + score
    };
  }
  function legacyCopy(txt) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:0;top:0;opacity:0;font-size:16px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, txt.length);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy failed'));
    });
  }
  function copyText(txt) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).catch(() => legacyCopy(txt));
    return legacyCopy(txt);
  }
  function copyLink(d) {
    return copyText(d.text + ' ' + d.url).then(
      () => { lastShare.via = 'copy'; toast('Link copied! Paste it to a friend.'); },
      () => { lastShare.via = 'shown'; toast('Copy this link: ' + d.url, 7000); });
  }
  function share() {
    const d = shareData();
    lastShare = { data: d, via: 'pending' };
    if (navigator.share) {
      return navigator.share(d).then(
        () => { lastShare.via = 'native'; },
        err => { if (err && err.name === 'AbortError') { lastShare.via = 'cancelled'; return null; } return copyLink(d); });
    }
    return copyLink(d);
  }

  // ---------- update ----------
  function choosePose(sp, zoomOn) {
    if (dog.stun > 0) return 'guilty';
    if (dog.hop > 0) return 'jumping';
    if (zoomOn) return sp > 80 ? 'zoomies' : 'mischievous';
    if (dog.pose === 'running' ? sp > 90 : sp > 170) return 'running';
    if (dog.carry) return 'mischievous';
    for (const t of treats) if (t.state === 'live' && hyp(t.x - dog.x, (t.y - dog.y) * 1.3) < 210) return 'searching';
    return 'idle';
  }

  function updateDog(dt, controllable) {
    const zoomOn = zoom.t > 0;
    const maxSp = zoomOn ? ZOOM_SPEED : SPEED;
    let dvx = 0, dvy = 0;
    if (dog.stun > 0) dog.stun -= dt;
    else if (controllable) {
      const kx = (input.keys.right ? 1 : 0) - (input.keys.left ? 1 : 0);
      const ky = (input.keys.down ? 1 : 0) - (input.keys.up ? 1 : 0);
      if (kx || ky) {
        const n = hyp(kx, ky);
        dvx = kx / n * maxSp; dvy = ky / n * maxSp * 0.8;
        input.has = false; zoom.lapping = false;
      } else {
        let tx = null, ty = null;
        if (zoomOn && !input.down) {
          if (!zoom.lapping) {
            zoom.lapping = true;
            zoom.dir = (dog.face > 0) === (dog.y < LAP.y) ? 1 : -1;
            zoom.lapA = Math.atan2((dog.y - LAP.y) / LAP.ry, (dog.x - LAP.x) / LAP.rx) + 0.7 * zoom.dir;
          }
          zoom.lapA += dt * maxSp * 0.85 / LAP.rx * zoom.dir;
          tx = LAP.x + Math.cos(zoom.lapA) * LAP.rx;
          ty = LAP.y + Math.sin(zoom.lapA) * LAP.ry;
        } else if (input.has) {
          if (input.snap && input.snap.item.state !== 'live' && input.snap.item.state !== 'floor') {
            input.snap = null;
            if (input.down) aim({ x: input.px, y: input.py });
          }
          zoom.lapping = false;
          tx = clamp(input.x, FIELD.x0, FIELD.x1);
          ty = clamp(input.y, FIELD.y0, FIELD.y1);
        }
        if (tx !== null) {
          const dx = tx - dog.x, dy = ty - dog.y, d = hyp(dx, dy);
          if (d > 6) { const sp = Math.min(maxSp, d * (zoomOn ? 7 : 5.5)); dvx = dx / d * sp; dvy = dy / d * sp; }
        }
      }
    }
    const acc = dog.stun > 0 ? 4 : (zoomOn ? 11 : 9);
    const f = 1 - Math.exp(-acc * dt);
    dog.vx += (dvx - dog.vx) * f;
    dog.vy += (dvy - dog.vy) * f;
    dog.x += dog.vx * dt;
    dog.y += dog.vy * dt;
    if (dog.x < FIELD.x0) { dog.x = FIELD.x0; dog.vx = Math.max(0, dog.vx); }
    if (dog.x > FIELD.x1) { dog.x = FIELD.x1; dog.vx = Math.min(0, dog.vx); }
    if (dog.y < FIELD.y0) { dog.y = FIELD.y0; dog.vy = Math.max(0, dog.vy); }
    if (dog.y > FIELD.y1) { dog.y = FIELD.y1; dog.vy = Math.min(0, dog.vy); }
    if (dog.invuln > 0) dog.invuln -= dt;
    if (dog.hop > 0) dog.hop -= dt;

    const sp = hyp(dog.vx, dog.vy);
    dog.speed = sp;
    if (Math.abs(dog.vx) > 40 && dog.stun <= 0) dog.face = Math.sign(dog.vx);
    dog.faceVis = approach(dog.faceVis, dog.face, dt * 9);
    dog.phase += dt * (3 + sp / 38);

    const np = choosePose(sp, zoomOn);
    dog.poseT += dt;
    const urgent = np === 'guilty' || np === 'jumping' || np === 'zoomies' || dog.pose === 'jumping' || dog.pose === 'guilty';
    if (np !== dog.pose && (dog.poseT > 0.14 || urgent)) { dog.pose = np; dog.poseT = 0; dog.pop = 1; }
    dog.pop = Math.max(0, dog.pop - dt * 7);
    animateDog();

    // dust puffs at the back feet when running fast
    dog.dustT -= dt;
    if (sp > 380 && dog.z < 6 && dog.dustT <= 0) {
      dog.dustT = 0.11;
      const s = depth(dog.y);
      particles.push({ kind: 'dust', x: dog.x - dog.face * 110 * s, y: dog.y - 6, vx: -dog.vx * 0.12, vy: -20, g: -10,
        t: 0, life: 0.5, size: rand(10, 16) * s, rot: 0, vr: 0 });
    }
    if (zoomOn) {
      const s = depth(dog.y);
      trail.push({ x: dog.x - dog.face * 20 * s, y: dog.y, h: dog.z + 100 * s, t: clock });
      while (trail.length && clock - trail[0].t > 0.38) trail.shift();
      if (Math.random() < 0.6) {
        particles.push({ kind: 'spark', x: dog.x - dog.face * 120 * s + rand(-20, 20), y: dog.y - rand(40, 160) * s,
          vx: -dog.vx * 0.2 + rand(-40, 40), vy: rand(-60, 20), g: 60, t: 0, life: rand(0.3, 0.6), size: rand(5, 10), rot: rand(0, 6), vr: rand(-5, 5), color: C.goldHi });
      }
    }
  }

  function animateDog() {
    const s = depth(dog.y);
    let z = 0, rot = 0, sx = 1, sy = 1;
    switch (dog.pose) {
      case 'running': {
        const b = Math.abs(Math.sin(dog.phase));
        z = b * 16 * s; rot = 0.03 * Math.sin(dog.phase * 2); sy = 1 + 0.03 * (b - 0.5); sx = 1 - 0.015 * (b - 0.5);
        break;
      }
      case 'zoomies': {
        const b = Math.abs(Math.sin(dog.phase * 1.15));
        z = 8 * s + b * 24 * s; rot = 0.05 + 0.05 * Math.sin(dog.phase * 2.3);
        break;
      }
      case 'jumping': {
        const k = clamp(1 - dog.hop / dog.hopDur, 0, 1);
        z = Math.sin(Math.PI * k) * 75 * s; rot = -0.12 + 0.24 * k;
        break;
      }
      case 'idle': sy = 1 + 0.012 * Math.sin(clock * 2.4); sx = 1 - 0.006 * Math.sin(clock * 2.4); break;
      case 'searching': rot = 0.02 * Math.sin(clock * 10); break;
      case 'mischievous': sx = 1 + 0.02 * Math.sin(clock * 7); rot = 0.02 * Math.sin(clock * 3.5); break;
      case 'guilty': rot = dog.poseT < 0.35 ? 0.03 * Math.sin(dog.poseT * 60) : 0; break;
      default: break;
    }
    dog.z = z; dog.rot = rot; dog.sx = sx; dog.sy = sy;
  }

  function updateVacuum(dt) {
    if (vac.frozen) return;
    const sv = depth(vac.y);
    if (vac.bonk > 0) {
      vac.bonk -= dt;
      vac.vz -= 2000 * dt;
      vac.z += vac.vz * dt;
      if (vac.z <= 0) { vac.z = 0; vac.vz = vac.vz < -200 ? -vac.vz * 0.3 : 0; }
      const fr = Math.exp(-2.6 * dt);
      vac.vx *= fr; vac.vy *= fr;
      vac.x += vac.vx * dt; vac.y += vac.vy * dt;
      vac.spin += vac.spinV * dt;
      vac.spinV *= Math.exp(-1.8 * dt);
      if (vac.x < VACF.x0 || vac.x > VACF.x1) { vac.vx *= -0.6; vac.x = clamp(vac.x, VACF.x0, VACF.x1); }
      if (vac.y < VACF.y0 || vac.y > VACF.y1) { vac.vy *= -0.6; vac.y = clamp(vac.y, VACF.y0, VACF.y1); }
      if (Math.random() < 0.25) particles.push({ kind: 'star', x: vac.x + rand(-40, 40), y: vac.y - vac.z - 90 * sv, vx: rand(-30, 30), vy: -40, g: 0, t: 0, life: 0.5, size: rand(7, 11), rot: 0, vr: 4, color: C.goldHi });
      if (vac.bonk <= 0) { vac.spin = 0; vac.z = 0; vac.pause = 0.5; vac.mode = 'wander'; vac.modeT = 0; }
      return;
    }
    if (vac.pause > 0) { vac.pause -= dt; return; }
    vac.modeT -= dt;
    if (vac.modeT <= 0) {
      const r = Math.random();
      vac.mode = r < 0.45 ? 'treat' : r < 0.7 ? 'chase' : 'wander';
      vac.modeT = rand(2.2, 3.8);
      if (vac.mode === 'wander') { vac.tx = rand(VACF.x0 + 40, VACF.x1 - 40); vac.ty = rand(VACF.y0 + 30, VACF.y1 - 30); }
      if (Math.random() < 0.2) vac.pause = rand(0.3, 0.7);   // robot vacuums like to stop and think
    }
    let tx = vac.tx, ty = vac.ty;
    if (vac.mode === 'chase') { tx = dog.x; ty = dog.y; }
    else if (vac.mode === 'treat') {
      let best = null, bd = 1e9;
      for (const t of treats) if (t.state === 'live' && t.appear >= 1) { const d = hyp(t.x - vac.x, t.y - vac.y); if (d < bd) { bd = d; best = t; } }
      if (best) { tx = best.x; ty = best.y; } else { tx = dog.x; ty = dog.y; }
    } else if (hyp(tx - vac.x, ty - vac.y) < 30) {
      vac.tx = rand(VACF.x0 + 40, VACF.x1 - 40); vac.ty = rand(VACF.y0 + 30, VACF.y1 - 30);
    }
    const want = Math.atan2(ty - vac.y, tx - vac.x);
    let da = want - vac.ang;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    vac.ang += clamp(da, -2.6 * dt, 2.6 * dt);
    const progress = clamp(playT / ROUND_TIME, 0, 1);
    vac.sp = (130 + 55 * progress) * (vac.mode === 'chase' ? 0.92 : 1);
    vac.vx = Math.cos(vac.ang) * vac.sp;
    vac.vy = Math.sin(vac.ang) * vac.sp * 0.8;
    vac.x += vac.vx * dt;
    vac.y += vac.vy * dt;
    if (vac.x < VACF.x0 || vac.x > VACF.x1) { vac.ang = Math.PI - vac.ang; vac.x = clamp(vac.x, VACF.x0, VACF.x1); }
    if (vac.y < VACF.y0 || vac.y > VACF.y1) { vac.ang = -vac.ang; vac.y = clamp(vac.y, VACF.y0, VACF.y1); }
    // the vacuum sucks up treats it rolls over
    vac.eatCd -= dt;
    for (const t of treats) {
      if (t.state === 'live' && t.appear >= 1 && hyp(t.x - vac.x, (t.y - vac.y) * 1.4) < 46 * sv) {
        t.state = 'eaten'; t.eatT = 0; t.ex = t.x; t.ey = t.y;
        if (vac.eatCd <= 0) { addText('slurp', vac.x, vac.y - 120 * sv, { size: 30, fill: C.cream, stroke: C.sageDark, life: 0.7 }); Sound.slurp(); vac.eatCd = 0.6; }
      }
    }
  }

  function updateTreats(dt) {
    const zoomOn = zoom.t > 0;
    for (const t of treats) {
      t.appear = clamp((clock - t.born) / 0.28, 0, 1);
      if (t.state === 'eaten') { t.eatT += dt; if (t.eatT > 0.25) t.state = 'dead'; continue; }
      // treats lean towards a running Uzi: a small nudge normally, a strong pull during Zoomies
      if (state === 'play' && t.state === 'live' && t.appear >= 1 && (zoomOn || (dog.speed > 60 && dog.stun <= 0))) {
        const dx = dog.x + dog.face * 40 - t.x, dy = dog.y - t.y, d = hyp(dx, dy);
        if (d < (zoomOn ? 210 : 100) && d > 1) { const m = Math.min(d, (zoomOn ? 600 : 240) * dt); t.x += dx / d * m; t.y += dy / d * m; }
      }
    }
    treats = treats.filter(t => t.state !== 'dead');
  }

  function updateBody(o, dt, bounce) {
    if (o.z > 0 || o.vz !== 0) {
      o.vz -= 2100 * dt;
      o.z += o.vz * dt;
      if (o.z <= 0) {
        o.z = 0;
        if (o.vz < -260) { o.vz = -o.vz * bounce; return true; }
        o.vz = 0;
      }
    }
    const air = o.z > 0;
    const fr = Math.exp(-(air ? 0.4 : 3.2) * dt);
    o.vx *= fr; o.vy *= fr;
    o.vrot *= Math.exp(-(air ? 0.3 : 4) * dt);
    o.x += o.vx * dt; o.y += o.vy * dt; o.rot += o.vrot * dt;
    if (o.x < ITEM.x0 || o.x > ITEM.x1) { o.vx *= -0.55; o.x = clamp(o.x, ITEM.x0, ITEM.x1); }
    if (o.y < ITEM.y0 || o.y > ITEM.y1) { o.vy *= -0.55; o.y = clamp(o.y, ITEM.y0, ITEM.y1); }
    return false;
  }

  function updatePillows(dt) {
    for (const p of pillows) {
      p.cd -= dt;
      if (updateBody(p, dt, 0.32)) { fluff(p.x, p.y - 20, 3); Sound.softThump(); }
      if (p.z === 0 && Math.abs(p.vrot) < 1.5) {
        const q = Math.PI / 2;
        const target = Math.round((p.rot - p.rest) / q) * q + p.rest;
        p.rot += (target - p.rot) * Math.min(1, dt * 5);
      }
    }
  }

  function updateSock(dt) {
    sock.cd -= dt;
    if (sock.state === 'carried') {
      sock.carryT += dt;
      if (sock.carryT > 6 && state === 'play') {
        flingSock();
        addText('toss!', dog.x, dog.y - 300 * depth(dog.y), { size: 34 });
      }
      return;
    }
    if (sock.state === 'flying') {
      if (updateBody(sock, dt, 0.4)) Sound.softThump();
      if (sock.z === 0 && sock.vz === 0 && hyp(sock.vx, sock.vy) < 30) sock.state = 'floor';
    } else {
      updateBody(sock, dt, 0.3);
    }
  }

  function updatePlant(dt) {
    plant.va += (-60 * plant.a - 5 * plant.va) * dt;
    plant.a += plant.va * dt;
    plant.cd -= dt;
  }

  function interactions() {
    if (dog.stun > 0) return;
    const s = depth(dog.y), zoomOn = zoom.t > 0;
    const cx = dog.x + dog.face * 40 * s, cy = dog.y, rx = 160 * s, ry = 72 * s;
    const inside = (x, y, pad) => { const dx = (x - cx) / (rx + pad), dy = (y - cy) / (ry + pad * 0.5); return dx * dx + dy * dy < 1; };
    // treats and the sock are taken with the mouth: a smaller zone from chest to nose
    const hx = dog.x + dog.face * MOUTH.dx * s, hrx = MOUTH.rx * s, hry = MOUTH.ry * s;
    const atMouth = (x, y) => { const dx = (x - hx) / hrx, dy = (y - cy) / hry; return dx * dx + dy * dy < 1; };
    for (const t of treats) if (t.state === 'live' && t.appear >= 1 && atMouth(t.x, t.y)) collectTreat(t);
    if (sock.state === 'floor' && sock.cd <= 0 && !dog.carry && atMouth(sock.x, sock.y)) grabSock();
    for (const p of pillows) if (p.cd <= 0 && p.z < 30 && inside(p.x, p.y, 20) && (dog.speed > 110 || zoomOn)) knockPillow(p);
    if (plant.cd <= 0 && dog.speed > 120 && Math.abs(dog.x - plant.x) < 150 * s && Math.abs(dog.y - plant.y) < 60) {
      plant.va += 3.2 * (plant.x >= dog.x ? 1 : -1) * (zoomOn ? 1.5 : 1);
      plant.cd = 0.8;
      sparks(plant.x, plant.y - 150, 5, { kind: 'leaf', min: 60, max: 180, g: 200 });
      Sound.rustle();
      if (!plant.hit) { plant.hit = true; score += 1; addText('+1', plant.x + 30, plant.y - 220, { size: 36 }); }
    }
    if (vac.bonk <= 0) {
      const sv = depth(vac.y);
      const vdx = (vac.x - dog.x) / (118 * s + 62 * sv), vdy = (vac.y - dog.y) / (42 * s + 30 * sv);
      if (vdx * vdx + vdy * vdy < 1) {
        if (zoomOn) bonkVacuum();
        else if (dog.invuln <= 0) hitByVacuum();
      }
    }
  }

  function updateFinale(dt) {
    fin.t += dt;
    const t = fin.t;
    fin.propAlpha = clamp(1 - t / 0.45, 0, 1);
    fin.chaos = clamp(t / 0.5, 0, 1);
    const L0 = 0.35, L1 = 1.05;
    if (t < L0) {
      const f = Math.exp(-6 * dt);
      dog.vx *= f; dog.vy *= f;
      dog.x += dog.vx * dt; dog.y += dog.vy * dt;
    } else {
      if (!fin.leap) {
        fin.leap = true;
        fin.x0 = dog.x; fin.y0 = dog.y;
        dog.pose = 'jumping'; dog.face = 1; dog.faceVis = 1; dog.pop = 0;
        Sound.whoosh();
      }
      const k = clamp((t - L0) / (L1 - L0), 0, 1), e = easeInCubic(k);
      dog.x = lerp(fin.x0, 380, e);
      dog.y = lerp(fin.y0, 1180, e);
      dog.finScale = lerp(1, 4.8, e);
      dog.z = Math.sin(k * Math.PI * 0.8) * 110 + e * 220;
      dog.rot = lerp(-0.1, 0.06, k);
      dog.sx = 1; dog.sy = 1;
    }
    if (t >= L1 && !fin.hit) {
      fin.hit = true;
      Sound.boing();
      Sound.fanfare();
      addShake(16, 0.4);
      vibrate(60);
    }
    if (t >= 2.0) {
      state = 'results'; res.t = 0;
      seen.rounds++;
      newBest = score > best;
      if (newBest) { best = score; try { localStorage.setItem('uzi-best', String(best)); } catch (e) { /* per-viewer convenience only */ } }
    }
  }

  function updateFx(dt) {
    for (const p of particles) {
      p.t += dt;
      p.vy += p.g * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.kind === 'fluff' || p.kind === 'dust') { p.vx *= Math.exp(-2 * dt); p.vy *= Math.exp(-2 * dt); }
    }
    particles = particles.filter(p => p.t < p.life);
    for (const t of texts) { t.t += dt; t.y -= 70 * dt; }
    texts = texts.filter(t => t.t < t.life);
    for (const b of bursts) b.t += dt;
    bursts = bursts.filter(b => b.t < 0.5);
    for (const f of flyers) { f.t += dt; if (f.t >= f.dur && !f.done) { f.done = true; hud.scorePop = 1; } }
    flyers = flyers.filter(f => f.t < f.dur);
    for (const b of banners) b.t += dt;
    banners = banners.filter(b => b.t < b.dur);
    hud.scorePop = Math.max(0, hud.scorePop - dt * 5);
    hud.timerPulse = Math.max(0, hud.timerPulse - dt * 3);
    hud.meterPulse = Math.max(0, hud.meterPulse - dt * 2);
    if (shake.t > 0) shake.t -= dt;
  }

  function update(dt) {
    clock += dt;
    if (state === 'title') {
      dog.poseT += dt;
      animateDog();
      updateTreats(dt);
      updatePlant(dt);
    } else if (state === 'play') {
      playT += dt;
      timeLeft = Math.max(0, ROUND_TIME - playT);
      hint.t += dt;
      tip.t += dt;
      if (zoom.t > 0) { zoom.t -= dt; if (zoom.t <= 0) endZoomies(); }
      updateDog(dt, true);
      updateVacuum(dt);
      updateTreats(dt);
      updatePillows(dt);
      updateSock(dt);
      updatePlant(dt);
      interactions();
      spawnCd -= dt;
      const live = treats.filter(t => t.state === 'live').length;
      const zoomOn = zoom.t > 0;
      // a new trail only once the floor is nearly cleared, so the meter fills over ~10-15 s of real play
      if (live < (zoomOn ? 5 : 3) && spawnCd <= 0) spawnCd = spawnTrail(randi(4, 6)) ? (zoomOn ? 0.6 : 1.1) : 0.2;
      const sec = Math.ceil(timeLeft);
      if (sec !== lastTick && sec <= 5 && sec > 0) { lastTick = sec; Sound.tick(); hud.timerPulse = 1; }
      const near = 1 - clamp(hyp(vac.x - dog.x, vac.y - dog.y) / 520, 0, 1);
      Sound.setHum(vac.bonk > 0 || vac.pause > 0 ? 0.004 : 0.01 + 0.03 * near);
      if (timeLeft <= 0) startFinale();
    } else if (state === 'finale') {
      updateFinale(dt);
      updatePillows(dt);
      updateSock(dt);
      updatePlant(dt);
    } else if (state === 'results') {
      res.t += dt;
    }
    if (state !== 'loading') updateFx(dt);
    meterVis = lerp(meterVis, zoom.t > 0 ? zoom.t / ZOOMIES_TIME : meter, 1 - Math.exp(-10 * dt));
  }

  // ---------- drawing helpers ----------
  function drawText(txt, x, y, size, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 700} ${size}px ${FONT}`;
    if (o.maxW) {
      const tw = ctx.measureText(txt).width;
      if (tw > o.maxW) { size *= o.maxW / tw; ctx.font = `${o.weight || 700} ${size}px ${FONT}`; }
    }
    ctx.textAlign = o.align || 'center';
    ctx.textBaseline = 'middle';
    if (o.ls && 'letterSpacing' in ctx) ctx.letterSpacing = o.ls + 'px';
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    if (o.shadow) { ctx.shadowColor = 'rgba(60,30,10,0.35)'; ctx.shadowOffsetY = size * 0.06; ctx.shadowBlur = size * 0.1; }
    if (o.stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = o.lw || size * 0.16;
      ctx.strokeStyle = o.stroke;
      ctx.strokeText(txt, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = o.fill || C.ink;
    ctx.fillText(txt, x, y);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawProp(name, x, y, visW, o = {}) {
    const im = IMG[name], b = PROP[name];
    const sc = visW / b[2];
    const ax = b[0] + b[2] / 2, ay = o.anchor === 'center' ? b[1] + b[3] / 2 : b[1] + b[3];
    ctx.save();
    if (o.alpha != null) ctx.globalAlpha *= o.alpha;
    ctx.translate(x, y);
    if (o.rot) ctx.rotate(o.rot);
    ctx.scale(sc * (o.flip || 1), sc * (o.sy || 1));
    ctx.drawImage(im, -ax, -ay);
    ctx.restore();
  }
  const propH = (name, visW) => visW * PROP[name][3] / PROP[name][2];

  function drawShadow(x, y, w, h, a) {
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.drawImage(SHADOW, x - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  function dogFlip() { const f = dog.faceVis; return (f < 0 ? -1 : 1) * Math.max(0.1, Math.abs(f)); }
  function dogScale() { return DOG_SCALE * depth(dog.y) * (1 + 0.06 * dog.pop) * dog.finScale; }

  function dogMouth() {
    const P = POSE[dog.pose], im = IMG[dog.pose];
    const sc = dogScale(), fx = dogFlip(), sign = fx < 0 ? -1 : 1;
    const ax = P.b[0] + P.b[2] / 2, ay = P.b[1] + P.b[3];
    const lx = (P.mouth[0] * im.naturalWidth - ax) * sc * fx * dog.sx;
    const ly = (P.mouth[1] * im.naturalHeight - ay) * sc * dog.sy;
    const r = dog.rot * sign, cs = Math.cos(r), sn = Math.sin(r);
    return { x: dog.x + lx * cs - ly * sn, y: dog.y - dog.z + lx * sn + ly * cs };
  }

  function drawDog() {
    const P = POSE[dog.pose], im = IMG[dog.pose];
    const sc = dogScale(), fx = dogFlip(), sign = fx < 0 ? -1 : 1;
    const ax = P.b[0] + P.b[2] / 2, ay = P.b[1] + P.b[3];
    ctx.save();
    let a = dog.alpha;
    if (dog.invuln > 0 && dog.stun <= 0 && Math.floor(clock * 12) % 2 === 0) a *= 0.55;
    ctx.globalAlpha *= a;
    ctx.translate(dog.x, dog.y - dog.z);
    ctx.rotate(dog.rot * sign);
    ctx.scale(sc * fx * dog.sx, sc * dog.sy);
    ctx.drawImage(im, -ax, -ay);
    ctx.restore();
  }

  function drawCarriedSock() {
    const m = dogMouth(), s = depth(dog.y), sign = dog.faceVis < 0 ? -1 : 1;
    // held by the cuff: the cuff sits in the mouth and the sock hangs and swings below it
    const w = 74 * s * dog.finScale, h = propH('sock', w);
    const swing = sign * (0.12 + 0.18 * Math.sin(clock * 11));
    ctx.save();
    ctx.translate(m.x, m.y - h * 0.06);
    ctx.rotate(swing);
    drawProp('sock', 0, h * 0.46, w, { anchor: 'center', flip: sign });
    ctx.restore();
  }

  function drawZoomTrail() {
    const za = clamp(zoom.t / 0.6, 0, 1);
    if (trail.length > 1) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1], b = trail[i], k = i / trail.length, s = depth(b.y);
          ctx.strokeStyle = pass === 0 ? `rgba(246,162,46,${0.22 * k * za})` : `rgba(255,232,160,${0.55 * k * za})`;
          ctx.lineWidth = (pass === 0 ? 50 : 12) * s * k;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y - a.h);
          ctx.lineTo(b.x, b.y - b.h);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    const sp = hyp(dog.vx, dog.vy);
    if (sp > 120) {
      const s = depth(dog.y), b = PROP.trail, im = IMG.trail;
      const len = 360 * s * clamp(sp / ZOOM_SPEED, 0.4, 1.1);
      const sc = len / b[2];
      ctx.save();
      ctx.globalAlpha *= 0.9 * za;
      ctx.translate(dog.x, dog.y - dog.z - 95 * s);
      ctx.rotate(Math.atan2(dog.vy * 0.8, dog.vx));
      ctx.scale(sc, sc * 1.1);
      ctx.drawImage(im, -(b[0] + b[2]), -(b[1] + b[3] / 2));
      ctx.restore();
    }
  }

  function drawTreat(t, pa) {
    if (t.appear <= 0) return;
    const s = depth(t.y);
    let sc = easeOutBack(t.appear), x = t.x, y = t.y;
    if (t.state === 'eaten') {
      const e = clamp(t.eatT / 0.25, 0, 1);
      x = lerp(t.ex, vac.x, e); y = lerp(t.ey, vac.y - 10, e); sc *= 1 - e;
    }
    if (sc <= 0.01) return;
    const bob = (6 + 4 * Math.sin(clock * 3.2 + t.phase)) * s;
    const w = 58 * s * sc, h = propH('treat', w);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (0.3 + 0.12 * Math.sin(clock * 4 + t.phase)) * pa;
    ctx.drawImage(GLOW, x - w * 1.0, y - bob - h / 2 - w * 0.62, w * 2.0, w * 1.24);
    ctx.restore();
    drawProp('treat', x, y - bob, w, { rot: t.rot, alpha: pa });
  }

  function drawPillow(p, pa) {
    const s = depth(p.y), w = 118 * s, h = propH('pillow', w);
    drawProp('pillow', p.x, p.y - p.z - h * 0.5, w, { anchor: 'center', rot: p.rot, alpha: pa });
  }

  function drawSock(pa) {
    const s = depth(sock.y), w = 82 * s, h = propH('sock', w);
    drawProp('sock', sock.x, sock.y - sock.z - h * 0.42, w, { anchor: 'center', rot: sock.rot, alpha: pa });
  }

  function drawVacuum() {
    const s = depth(vac.y), w = 150 * s, h = propH('vacuum', w);
    if (vac.bonk > 0) drawProp('vacuum', vac.x, vac.y - vac.z - h * 0.5, w, { anchor: 'center', rot: vac.spin });
    else {
      const moving = state === 'play' && vac.pause <= 0 && !vac.frozen;
      drawProp('vacuum', vac.x, vac.y + 2, w, { rot: moving ? 0.022 * Math.sin(clock * 9) : 0 });
    }
  }

  function drawPlant() {
    const s = depth(plant.y);
    drawProp('plant', plant.x, plant.y + 4, 132 * s, { rot: plant.a });
  }

  // ---------- scene ----------
  function drawPlate(im) {
    // slight overscan so screen shake never reveals the page behind the room
    const ox = 10, oy = ox * H / W, m = 14;
    ctx.drawImage(im, -ox, -oy, W + ox * 2, H + oy * 2);
    const iw = im.naturalWidth, ih = im.naturalHeight, k = ih / (H + oy * 2);
    if (view.top < -oy + m) {            // tall screen: mirror the wall upwards
      const hh = -oy - view.top + m;
      ctx.save();
      ctx.translate(0, -oy + 0.5); ctx.scale(1, -1);
      ctx.drawImage(im, 0, 0, iw, hh * k, -ox, 0, W + ox * 2, hh);
      ctx.restore();
    }
    if (view.bottom > H + oy - m) {      // and the floor downwards
      const hh = view.bottom - H - oy + m;
      ctx.save();
      ctx.translate(0, H + oy - 0.5); ctx.scale(1, -1);
      ctx.drawImage(im, 0, ih - hh * k, iw, hh * k, -ox, -hh, W + ox * 2, hh);
      ctx.restore();
    }
  }

  function drawRoom() {
    drawPlate(IMG.room);
    const ch = state === 'finale' || state === 'results' ? fin.chaos : 0;
    if (ch > 0) {
      ctx.save();
      ctx.globalAlpha = ch;
      drawPlate(IMG.chaos);
      ctx.restore();
    }
    // the extra wall and floor fade slightly so the eye stays on the room
    if (view.top < -2) {
      const g = ctx.createLinearGradient(0, view.top, 0, 0);
      g.addColorStop(0, 'rgba(60,38,26,0.30)'); g.addColorStop(1, 'rgba(60,38,26,0)');
      ctx.fillStyle = g; ctx.fillRect(-20, view.top - 20, W + 40, -view.top + 20);
    }
    if (view.bottom > H + 2) {
      const g = ctx.createLinearGradient(0, H, 0, view.bottom);
      g.addColorStop(0, 'rgba(60,38,26,0)'); g.addColorStop(1, 'rgba(60,38,26,0.34)');
      ctx.fillStyle = g; ctx.fillRect(-20, H, W + 40, view.bottom - H + 20);
    }
  }

  function drawWorld() {
    const pa = state === 'finale' ? fin.propAlpha : 1;
    const finaleDog = state === 'finale' && fin.leap;
    // shadows first, all on the floor
    for (const t of treats) if (t.state === 'live' && t.appear > 0) { const s = depth(t.y); drawShadow(t.x, t.y + 2, 54 * s * t.appear, 14 * s, 0.28 * pa); }
    for (const p of pillows) { const s = depth(p.y), k = 1 - Math.min(0.55, p.z / 300); drawShadow(p.x, p.y, 120 * s * k, 26 * s * k, 0.34 * k * pa); }
    if (sock.state !== 'carried') { const s = depth(sock.y), k = 1 - Math.min(0.55, sock.z / 300); drawShadow(sock.x, sock.y, 84 * s * k, 20 * s * k, 0.3 * k * pa); }
    { const s = depth(vac.y), k = 1 - Math.min(0.6, vac.z / 250); drawShadow(vac.x, vac.y - 4, 170 * s * k, 38 * s * k, 0.42 * k); }
    { const s = depth(plant.y); drawShadow(plant.x + 6, plant.y - 2, 128 * s, 28 * s, 0.4); }
    if (!finaleDog) {
      const s = depth(dog.y), k = 1 - Math.min(0.5, dog.z / 220);
      const w = (dog.pose === 'guilty' ? 170 : 270) * s * k;
      drawShadow(dog.x, dog.y - 4, w, 46 * s * k, 0.44 * k);
    }
    const list = [];
    for (const t of treats) list.push({ y: t.y, f: () => drawTreat(t, pa) });
    for (const p of pillows) list.push({ y: p.y, f: () => drawPillow(p, pa) });
    if (sock.state !== 'carried') list.push({ y: sock.y, f: () => drawSock(pa) });
    list.push({ y: vac.y, f: drawVacuum });
    list.push({ y: plant.y, f: drawPlant });
    list.push({ y: dog.y + (finaleDog ? 5000 : 0), f: () => { if (zoom.t > 0) drawZoomTrail(); drawDog(); if (dog.carry) drawCarriedSock(); } });
    list.sort((a, b) => a.y - b.y);
    for (const o of list) o.f();
  }

  function drawStar(x, y, r, rot) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + i * Math.PI / 4, rr = i % 2 === 0 ? r : r * 0.38;
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function drawFx() {
    for (const b of bursts) {
      const k = b.t / 0.5;
      drawProp('burst', b.x, b.y - 50 * easeOutCubic(k) * b.s, (60 + 80 * easeOutCubic(k)) * b.s, { anchor: 'center', alpha: 1 - k * k });
    }
    for (const p of particles) {
      const k = p.t / p.life, a = 1 - k;
      ctx.save();
      ctx.globalAlpha *= a;
      if (p.kind === 'spark' || p.kind === 'star') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = p.color || C.goldHi;
        drawStar(p.x, p.y, p.size * (p.kind === 'star' ? 1.2 : 1), p.rot);
      } else if (p.kind === 'fluff') {
        ctx.fillStyle = 'rgba(255,250,240,0.95)';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.6 + 0.4 * k), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'dust') {
        ctx.globalAlpha *= 0.45;
        ctx.fillStyle = '#f6e6cc';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.7 + 0.8 * k), 0, Math.PI * 2); ctx.fill();
      } else if (p.kind === 'leaf') {
        ctx.fillStyle = '#6f9b4d';
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.beginPath(); ctx.ellipse(0, 0, p.size, p.size * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }
    for (const t of texts) {
      const k = t.t / t.life;
      const sc = t.t < 0.15 ? easeOutBack(t.t / 0.15) : 1;
      ctx.save();
      ctx.globalAlpha = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
      ctx.translate(t.x, t.y);
      ctx.scale(sc, sc);
      drawText(t.txt, 0, 0, t.size, { fill: t.fill, stroke: t.stroke, lw: t.size * 0.2 });
      ctx.restore();
    }
  }

  function drawFlyers() {
    for (const f of flyers) {
      const k = easeInCubic(clamp(f.t / f.dur, 0, 1));
      const x1 = 58, y1 = 64 + view.hudY;
      const mx = lerp(f.x0, x1, 0.5) + 60, my = Math.min(f.y0, y1) - 120;
      const x = (1 - k) * (1 - k) * f.x0 + 2 * (1 - k) * k * mx + k * k * x1;
      const y = (1 - k) * (1 - k) * f.y0 + 2 * (1 - k) * k * my + k * k * y1;
      drawProp('icon', x, y, lerp(56, 40, k), { anchor: 'center' });
    }
  }

  // ---------- HUD ----------
  function drawHud() {
    const a = state === 'finale' ? clamp(1 - fin.t / 0.3, 0, 1) : 1;
    if (a <= 0) return;
    ctx.save();
    ctx.translate(0, view.hudY);
    ctx.globalAlpha = a;
    // score capsule with the sweet potato badge
    const pb = PROP.panel, pim = IMG.panel;
    const sw = 270, ssc = sw / pb[2] * (1 + 0.08 * hud.scorePop);
    const scx = 30 + sw / 2, scy = 68;
    ctx.save();
    ctx.translate(scx, scy); ctx.scale(ssc, ssc);
    ctx.drawImage(pim, -(pb[0] + pb[2] / 2), -(pb[1] + pb[3] / 2));
    ctx.restore();
    drawProp('icon', 62, 64, 92 * (1 + 0.15 * hud.scorePop), { anchor: 'center', rot: -0.15 });
    drawText(String(score), scx + 34, scy + 2, 46, { fill: C.ink });
    // timer capsule
    const tw = 230, tsc = tw / pb[2] * (1 + 0.1 * hud.timerPulse);
    const tcx = W - 28 - tw / 2;
    ctx.save();
    ctx.translate(tcx, scy); ctx.scale(tsc, tsc);
    ctx.drawImage(pim, -(pb[0] + pb[2] / 2), -(pb[1] + pb[3] / 2));
    ctx.restore();
    const secs = Math.ceil(timeLeft);
    const low = secs <= 5;
    drawText(`0:${String(secs).padStart(2, '0')}`, tcx, scy + 2, 38, { fill: low ? C.coral : C.ink });
    // Zoomies meter: live fill behind the frame's transparent opening
    const mb = PROP.meter, mim = IMG.meter;
    const mw = 440, msc = mw / mb[2] * (1 + 0.06 * hud.meterPulse);
    const mcx = W / 2, mcy = 160;
    const ix = mcx - (mb[0] + mb[2] / 2) * msc, iy = mcy - (mb[1] + mb[3] / 2) * msc;
    const hx0 = ix + HOLE.x0 * mim.naturalWidth * msc, hx1 = ix + HOLE.x1 * mim.naturalWidth * msc;
    const hy0 = iy + HOLE.y0 * mim.naturalHeight * msc, hy1 = iy + HOLE.y1 * mim.naturalHeight * msc;
    const hh = hy1 - hy0, hw = hx1 - hx0;
    const zoomOn = zoom.t > 0;
    ctx.save();
    roundRect(hx0 - 2, hy0 - 2, hw + 4, hh + 4, (hh + 4) / 2);
    ctx.clip();
    ctx.fillStyle = 'rgba(92,70,52,0.30)';
    ctx.fillRect(hx0 - 2, hy0 - 2, hw + 4, hh + 4);
    const fw = (hw + 4) * clamp(meterVis, 0, 1);
    if (fw > 0.5) {
      const gr = ctx.createLinearGradient(hx0, 0, hx1, 0);
      gr.addColorStop(0, C.gold); gr.addColorStop(1, C.goldHi);
      ctx.fillStyle = gr;
      ctx.fillRect(hx0 - 2, hy0 - 2, fw, hh + 4);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(hx0 - 2, hy0 - 2, fw, (hh + 4) * 0.38);
      if (zoomOn) {
        ctx.fillStyle = 'rgba(255,255,255,0.22)';
        const off = (clock * 140) % 40;
        for (let x = hx0 - 40 + off; x < hx0 + fw; x += 40) {
          ctx.beginPath();
          ctx.moveTo(x, hy1 + 2); ctx.lineTo(x + 16, hy1 + 2); ctx.lineTo(x + 36, hy0 - 2); ctx.lineTo(x + 20, hy0 - 2);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    ctx.restore();
    if (zoomOn || meterVis > 0.85) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha *= 0.35 + 0.25 * Math.sin(clock * 10);
      ctx.drawImage(GLOW, hx0 - 30, hy0 - 40, hw + 60, hh + 80);
      ctx.restore();
    }
    ctx.save();
    ctx.translate(mcx, mcy); ctx.scale(msc, msc);
    ctx.drawImage(mim, -(mb[0] + mb[2] / 2), -(mb[1] + mb[3] / 2));
    ctx.restore();
    const label = zoomOn ? 'ZOOMIES!' : 'ZOOMIES';
    const lp = zoomOn ? 1 + 0.06 * Math.sin(clock * 14) : 1;
    drawText(label, mcx, (hy0 + hy1) / 2 + 1, 28 * lp, { fill: C.creamHi, stroke: C.choc, lw: 6, ls: 3 });
    ctx.restore();
  }

  function drawVignette() {
    if (zoom.t <= 0 || state !== 'play') return;
    ctx.save();
    ctx.globalAlpha = clamp(zoom.t / 0.5, 0, 1) * (0.55 + 0.15 * Math.sin(clock * 9));
    ctx.drawImage(VIGNETTE, 0, view.top, W, view.h);
    ctx.restore();
  }

  function drawBanners() {
    for (const b of banners) {
      const k = b.t / b.dur;
      const sc = b.t < 0.3 ? easeOutBack(b.t / 0.3) : 1;
      ctx.save();
      ctx.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      ctx.translate(360, b.y);
      ctx.rotate(-0.05);
      ctx.scale(sc, sc);
      drawText(b.txt, 0, 0, b.size, { fill: b.fill, stroke: C.choc, lw: 18, shadow: true });
      ctx.restore();
    }
  }

  function pill(txt, cx, cy, size, o = {}) {
    ctx.save();
    ctx.font = `${o.weight || 600} ${size}px ${FONT}`;
    const w = Math.min(W - 36, ctx.measureText(txt).width + size * 1.8), h = size * 2.1;
    const x = clamp(cx, w / 2 + 14, W - w / 2 - 14);
    roundRect(x - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fillStyle = o.bg || 'rgba(242,228,205,0.95)'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = o.line || C.sage; ctx.stroke();
    ctx.restore();
    drawText(txt, x, cy + 1, size, { fill: o.fill || C.ink, weight: o.weight || 600, maxW: w - size });
  }

  function drawTitle() {
    const bob = Math.sin(clock * 2) * 4;
    const ty = (view.hudY >= 0 ? view.hudY : view.hudY * 0.5) + bob;
    drawText('UZI', 360, 236 + ty, 176, { fill: C.creamHi, stroke: C.choc, lw: 22, shadow: true });
    drawText('IS HOME ALONE', 360, 336 + ty, 64, { fill: C.creamHi, stroke: C.choc, lw: 14, shadow: true, ls: 2 });
    pill('Drag to run · Grab treats · Get the Zoomies', 360, 428 + ty, 27);
    const sub = dare ? `A friend scored ${dare}. Can you beat it?` : best > 0 ? `Your best: ${best}` : '';
    if (sub) pill(sub, 360, 500 + ty, 25, { line: C.gold, weight: 700 });
  }

  function showTip(txt, dur) { tip.txt = txt; tip.t = 0; tip.dur = dur; }

  function drawTip() {
    if (tip.t >= tip.dur) return;
    const a = clamp(tip.t / 0.2, 0, 1) * clamp((tip.dur - tip.t) / 0.4, 0, 1);
    const drop = (1 - easeOutBack(clamp(tip.t / 0.3, 0, 1))) * 18;
    ctx.save();
    ctx.globalAlpha = a;
    pill(tip.txt, 360, view.hudY + 238 - drop, 27, { line: C.gold, weight: 700 });
    ctx.restore();
  }

  // first round only: the vacuum introduces itself
  function drawVacTag() {
    if (seen.rounds > 0 || playT < 1.2 || playT > 5.5 || vac.bonk > 0) return;
    const a = clamp((playT - 1.2) / 0.3, 0, 1) * clamp((5.5 - playT) / 0.4, 0, 1), s = depth(vac.y);
    ctx.save();
    ctx.globalAlpha = a;
    pill('Dodge me!', vac.x, vac.y - 150 * s + 4 * Math.sin(clock * 6), 24, { line: C.coral, weight: 700 });
    ctx.restore();
  }

  function drawHint() {
    if (input.everMoved || hint.t > 7) return;
    const target = treats.find(t => t.state === 'live' && t.appear >= 1);
    if (!target) return;
    const k = (hint.t % 1.8) / 1.8;
    const e = easeOutCubic(clamp(k / 0.75, 0, 1));
    // the ghost finger sits where a real finger would: below Uzi on touch screens
    const lift = COARSE ? FINGER_LIFT : 30;
    const x = lerp(dog.x + 20, target.x, e), y = lerp(dog.y, target.y, e) + lift;
    const a = clamp(hint.t / 0.4, 0, 1) * (k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(255,253,248,0.65)';
    ctx.beginPath(); ctx.arc(x, y, 30, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(255,253,248,0.9)';
    ctx.beginPath(); ctx.arc(x, y, 42 + 8 * Math.sin(clock * 8), 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.globalAlpha = clamp(hint.t / 0.4, 0, 1);
    pill('Drag to run!', 360, Math.min(view.floorY - 56, 1240), 30, { weight: 700 });
    ctx.restore();
  }

  function drawFinaleOverlay() {
    const t = state === 'results' ? 9 : fin.t;
    if (t < 0.9) return;
    if (t >= 1.05) {
      const k = clamp((t - 1.05) / 0.7, 0, 1);
      // the picture covers the whole screen: scaled up on tall phones, cropped at the top on short ones
      const z = lerp(1.14, 1.0, easeOutCubic(k)) * Math.max(1, view.h / H);
      const cy = view.h >= H ? view.top + view.h / 2 : H / 2;
      ctx.save();
      ctx.translate(W / 2, cy);
      ctx.scale(z, z);
      ctx.drawImage(IMG.finale, -W / 2, -H / 2, W, H);
      ctx.restore();
    }
    const flash = t < 1.05 ? (t - 0.9) / 0.15 : 1 - (t - 1.05) / 0.35;
    if (flash > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(flash, 0, 1);
      ctx.fillStyle = C.creamHi;
      ctx.fillRect(-30, view.top - 30, W + 60, view.h + 60);
      ctx.restore();
    }
  }

  function rating() {
    const s = score;
    const name = s >= RANKS[4] ? 'Zoomies Legend' : s >= RANKS[3] ? 'Chaos Gremlin' : s >= RANKS[2] ? 'Sofa Wrecker'
      : s >= RANKS[1] ? 'Little Rascal' : s >= RANKS[0] ? 'Snack Detective' : 'Suspiciously Good Boy';
    let line = 'Somebody had a busy afternoon.';
    if (stats.bonks >= 2) line = 'The vacuum is filing a complaint.';
    else if (stats.socks >= 2) line = 'No sock in this house is safe.';
    else if (stats.pillows >= 5) line = 'The sofa has been redecorated.';
    else if (stats.treats >= 30) line = 'Not one sweet potato survived.';
    else if (stats.oops >= 3) line = 'The vacuum won this round.';
    else if (s < RANKS[0]) line = 'Nothing to see here. Probably.';
    return { name, line };
  }

  function drawResults() {
    const k = easeOutBack(clamp(res.t / 0.55, 0, 1));
    const a = clamp(res.t / 0.25, 0, 1);
    const r = rating();
    ctx.save();
    ctx.globalAlpha = a;
    // title banner
    const by = lerp(view.top - 190, view.hudY + 36, k);
    roundRect(64, by, 592, 156, 42);
    ctx.fillStyle = C.sage; ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = C.cream; ctx.stroke();
    drawText("UZI'S TITLE TODAY", 360, by + 36, 24, { fill: C.cream, weight: 600, ls: 5 });
    drawText(r.name.toUpperCase(), 360, by + 84, 52, { fill: C.creamHi, stroke: C.sageDark, lw: 10, maxW: 540 });
    drawText(r.line, 360, by + 128, 25, { fill: C.cream, weight: 500, maxW: 540 });
    // stats panel, sitting just above the Play Again and Share buttons
    const py = lerp(view.bottom + 40, view.floorY - 30 - 96 - 26 - 226, k);
    roundRect(40, py, 640, 226, 46);
    ctx.fillStyle = 'rgba(242,228,205,0.97)'; ctx.fill();
    ctx.lineWidth = 7; ctx.strokeStyle = C.sage; ctx.stroke();
    drawText(`${score} points`, 360, py + 56, 54, { fill: C.ink });
    const cols = [
      { icon: 'treat', w: 64, n: stats.treats, label: stats.treats === 1 ? 'treat' : 'treats' },
      { icon: 'pillow', w: 50, n: stats.pillows, label: stats.pillows === 1 ? 'pillow' : 'pillows' },
      { icon: 'sock', w: 48, n: stats.socks, label: stats.socks === 1 ? 'sock' : 'socks' },
      { icon: 'vacuum', w: 70, n: stats.bonks, label: stats.bonks === 1 ? 'bonk' : 'bonks' }
    ];
    cols.forEach((c, i) => {
      const cx = 125 + i * 157;
      drawProp(c.icon, cx, py + 124, c.w, { anchor: 'center' });
      drawText(`${c.n} ${c.label}`, cx, py + 182, 26, { fill: C.ink, weight: 600 });
    });
    if (newBest && score > 0) {
      ctx.save();
      ctx.translate(590, py + 8);
      ctx.rotate(0.14);
      ctx.scale(1 + 0.05 * Math.sin(clock * 6), 1 + 0.05 * Math.sin(clock * 6));
      roundRect(-88, -24, 176, 48, 24);
      ctx.fillStyle = C.gold; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = C.choc; ctx.stroke();
      drawText('NEW BEST!', 0, 1, 25, { fill: C.choc });
      ctx.restore();
    } else if (best > 0) {
      drawText(`Best ${best}`, 646, py + 36, 22, { fill: C.sageDark, weight: 600, align: 'right' });
    }
    ctx.restore();
  }

  function drawLoading() {
    ctx.fillStyle = '#2f3d35';
    ctx.fillRect(0, view.top, W, view.h);
    const cy = view.top + view.h / 2;
    if (loadError) {
      drawText('The game art did not load.', 360, cy - 24, 34, { fill: C.cream, weight: 600, maxW: 640 });
      drawText('Tap to try again', 360, cy + 30, 30, { fill: C.goldHi, weight: 600 });
      return;
    }
    drawText('Uzi is waking up…', 360, cy - 34, 42, { fill: C.cream, weight: 600 });
    roundRect(210, cy + 14, 300, 18, 9);
    ctx.fillStyle = 'rgba(242,228,205,0.22)'; ctx.fill();
    const p = clamp(loadState.done / loadState.total, 0.04, 1);
    roundRect(210, cy + 14, 300 * p, 18, 9);
    ctx.fillStyle = C.gold; ctx.fill();
  }

  function drawGallery() {
    ctx.fillStyle = C.cream;
    ctx.fillRect(0, 0, W, H);
    const names = Object.keys(POSE);
    names.forEach((name, i) => {
      const col = i % 2, row = Math.floor(i / 2);
      const x = 190 + col * 340, y = 300 + row * 300;
      const P = POSE[name], im = IMG[name], sc = DOG_SCALE * 0.78;
      const ax = P.b[0] + P.b[2] / 2, ay = P.b[1] + P.b[3];
      ctx.drawImage(im, x - ax * sc, y - ay * sc, im.naturalWidth * sc, im.naturalHeight * sc);
      const mx = x + (P.mouth[0] * im.naturalWidth - ax) * sc, my = y + (P.mouth[1] * im.naturalHeight - ay) * sc;
      drawProp('sock', mx, my + 58 * 0.46 - 3, 58, { anchor: 'center' });
      ctx.fillStyle = '#d0342c'; ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2050d0'; ctx.beginPath(); ctx.arc(mx, my, 6, 0, Math.PI * 2); ctx.fill();
      drawText(name, x, y + 24, 22, { fill: C.ink });
    });
  }

  function drawDebug() {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,0,0,0.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(FIELD.x0, FIELD.y0, FIELD.x1 - FIELD.x0, FIELD.y1 - FIELD.y0);
    const s = depth(dog.y);
    ctx.beginPath(); ctx.ellipse(dog.x + dog.face * 40 * s, dog.y, 160 * s, 72 * s, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,160,0,0.8)';
    ctx.beginPath(); ctx.ellipse(dog.x + dog.face * MOUTH.dx * s, dog.y, MOUTH.rx * s, MOUTH.ry * s, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(0,80,255,0.6)';
    const sv = depth(vac.y);
    ctx.beginPath(); ctx.ellipse(dog.x, dog.y, 118 * s + 62 * sv, 42 * s + 30 * sv, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function render() {
    ctx.setTransform(K, 0, 0, K, 0, -view.top * K);
    if (state === 'loading' || state === 'error') { drawLoading(); return; }
    if (GALLERY) { drawGallery(); return; }
    let sx = 0, sy = 0;
    if (shake.t > 0) { const k = shake.t / shake.dur; sx = (Math.random() * 2 - 1) * shake.mag * k; sy = (Math.random() * 2 - 1) * shake.mag * k; }
    ctx.save();
    ctx.translate(sx, sy);
    drawRoom();
    drawWorld();
    drawFx();
    ctx.restore();
    drawVignette();
    if (state === 'play' || state === 'finale') { drawHud(); drawFlyers(); }
    if (state === 'title') drawTitle();
    if (state === 'play') { drawHint(); drawVacTag(); drawTip(); }
    drawBanners();
    if (state === 'finale' || state === 'results') drawFinaleOverlay();
    if (state === 'results') drawResults();
    if (DEBUG && /debug=draw/.test(QS)) drawDebug();
  }

  // The buttons are real page elements on top of the canvas, so taps count as user gestures for sound and sharing.
  let uiKey = '';
  function syncUi() {
    const btns = state === 'results' && res.t > 0.45;
    const key = state + (held ? ':held' : '') + (btns ? ':btn' : '');
    if (key === uiKey) return;
    uiKey = key;
    $('frame').dataset.state = state;
    ui.play.hidden = state !== 'title';
    ui.results.classList.toggle('show', btns);
    ui.again.disabled = ui.share.disabled = !btns;
    ui.pause.hidden = !held;
    ui.mute.hidden = state === 'loading' || state === 'error';
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(nowMs) {
    const dt = Math.min(0.05, Math.max(0, (nowMs - last) / 1000));
    last = nowMs;
    if (!paused && !held) update(dt);
    render();
    syncUi();
    requestAnimationFrame(frame);
  }

  // ---------- test hooks (only with ?debug) ----------
  if (DEBUG) {
    window.__uzi = {
      get s() {
        return {
          state, held, paused, timeLeft: +timeLeft.toFixed(2), score, meter: +meter.toFixed(2), zoom: +zoom.t.toFixed(2),
          dog: { x: Math.round(dog.x), y: Math.round(dog.y), pose: dog.pose, carry: dog.carry, stun: dog.stun > 0, face: dog.face },
          target: { x: Math.round(input.x), y: Math.round(input.y), snap: !!input.snap },
          stats: Object.assign({}, stats), live: treats.filter(t => t.state === 'live').length,
          vac: { x: Math.round(vac.x), y: Math.round(vac.y), mode: vac.mode, bonk: vac.bonk > 0 },
          sock: sock.state, pillows: pillows.map(p => [Math.round(p.x), Math.round(p.y), p.hits]), muted: Sound.muted,
          hole: HOLE, rating: rating(), best, newBest, tip: tip.t < tip.dur ? tip.txt : '', view: Object.assign({}, view)
        };
      },
      get lastShare() { return lastShare; },
      start: startGame,
      press(x, y, lift) { return pressAt({ x, y }, lift || 0, 'test'); },
      move(x, y) { if (input.down) aim({ x, y }); },
      release() { input.down = false; input.pid = null; },
      setTime(t) { playT = ROUND_TIME - t; },
      fillMeter() { meter = 0.95; },
      zoomies: () => startZoomies(),
      teleport(x, y) { dog.x = x; dog.y = y; dog.vx = 0; dog.vy = 0; },
      placeVac(x, y) { vac.x = x; vac.y = y; },
      freezeVac(on) { vac.frozen = !!on; },
      sockAt(x, y) { Object.assign(sock, { x, y, z: 0, vx: 0, vy: 0, vz: 0, state: 'floor', cd: 0 }); dog.carry = false; },
      treatsLive: () => treats.filter(t => t.state === 'live').map(t => [Math.round(t.x), Math.round(t.y)]),
      clearTreats() { treats = []; spawnCd = 999; },
      addTreat(x, y) { treats.push(makeTreat(x, y, -1)); },
      pause(on) { if (on) pauseGame(); else resumeGame(); },
      hide: onHide, show: onShow, share,
      // advance the game by fixed 1/60 s steps without waiting for animation frames
      step(seconds, fn) {
        const n = Math.round(seconds * 60);
        for (let i = 0; i < n; i++) { if (fn) fn(i); update(1 / 60); }
        render(); syncUi();
        return this.s;
      }
    };
  }

  // ---------- boot ----------
  setMuteUi();
  requestAnimationFrame(frame);
  loadAll().then(() => {
    measureMeterHole();
    resetWorld();
    state = 'title';
    if (document.fonts && document.fonts.load) document.fonts.load(`700 40px ${FONT}`).catch(() => {});
  }).catch(err => {
    state = 'error';
    loadError = 'The game art did not load.';
    if (window.console) console.error(err);
  });
})();
