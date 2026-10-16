/* HOPPER — No Signal. An original endless hopper starring a thruster-hopping pickup. */
(() => {
  'use strict';

  // ---------- params ----------
  const Q = new URLSearchParams(location.search);
  let BOT = Q.get('bot') === '1';
  const REC = Q.get('rec') === '1';
  const SCALE_PARAM = parseFloat(Q.get('scale') || '0') || 0;
  const SEED = Q.has('seed') ? (parseInt(Q.get('seed'), 10) >>> 0) : (REC ? 1337 : (Math.random() * 1e9) >>> 0);

  function mulberry(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const rng = mulberry(SEED);
  const botRng = mulberry(SEED ^ 0x9e3779b9);
  const fxRng = mulberry(SEED ^ 0x1234567);
  const rint = (a, b) => Math.floor(rng() * (b - a + 1)) + a;

  // ---------- band size (fixed at load) ----------
  // Wide windows: band fills ~80% of the height, >=480 game px wide. Portrait phones: ~340 px wide (bigger pixels), taller band, centred.
  function pickScale(aw, ah, hh) {
    const minW = aw < ah ? 340 : 480;
    const fit = Math.min(ah * 0.8 / hh, aw / minW);
    if (SCALE_PARAM) return SCALE_PARAM;
    const s = Math.floor(fit);
    return (s < 1 || s < fit * 0.86) ? fit : s;
  }
  const H = (() => {
    const d = window.devicePixelRatio || 1, aw = window.innerWidth * d, ah = window.innerHeight * d;
    const s = pickScale(aw, ah, 216), w = aw / s;
    return Math.max(216, Math.min(300, Math.floor(ah * 0.8 / s), Math.floor(w * 0.75)));
  })();
  const GROUND = H - 66;   // a deep filled Mars ground band

  // ---------- constants (per-frame units at 60 fps) ----------
  const HERO_X = 36, HERO_W = 80;
  const STEP = 1 / 60;
  const GRAVITY = 0.6, JUMP_V = -10, DROP_V = -5, MIN_JUMP = 30, MAX_JUMP = 63, DROP_COEF = 3;
  const SPEED0 = 6, SPEED_MAX = 11.5, ACCEL = 0.001;
  const SCORE_COEF = 0.025, CLEAR_FRAMES = 20, NIGHT_EVERY = 700, NIGHT_FRAMES = 720, GAP_COEF = 0.6, MAX_GAP_COEF = 1.5;
  const WIG_AFTER = REC ? 330 : 700; // frames of play before wigs may appear

  // ---------- palette: unmistakable Mars — butterscotch sky, filled rust ground, red hills; lime hero, golden hairpieces ----------
  const PAL = {
    s1: '#d9a27a', s2: '#dea880', s3: '#e3ae85', s4: '#e8b48a',  // sky bands, top → horizon
    hz: '#efc39c',                                               // dust haze near the horizon, dust devils
    p: '#d8e8f0', p2: '#e9c3a0',                                 // small pale-blue setting sun + halo
    f0: '#c76a48', f1: '#a9503a', f2: '#8e3f2c',                  // far hills: lit rim, fill, shadow side
    hl: '#d06a45', r: '#b5462b', R: '#8a2f1d', RR: '#6e2414',    // ground: highlight, base, shadow, deep shadow
    k: '#3a1a10', c: '#f4e6cf', cs: '#d9c2a2',                   // obstacles: dark outline, cream ink, cream shade
    b: '#4a2414', b2: '#8a5a3e', dl: '#e3a27c',                  // HUD brown, HI brown, light dust
    w: '#ece8e4', x: '#ffffff',                                   // vapor light, vapor core
    // car (pearl white, black canopy and sill, dark aero wheels)
    o: '#17191c', O: '#1f2226',
    V: '#ffffff', A: '#f2f2ee', a: '#c9ccd0', d: '#adb1b6', D: '#8e949b',
    q: '#121417', Q: '#2a2e33', G: '#4b5159',
    t: '#1b1c1e', T: '#2b2d30', n: '#33363b', N: '#5a6068',
    X: '#ffffff', Z: '#c0282f',
    // straw-blond hairpiece
    L: '#fff3c4', Y: '#f3cf63', y: '#d7a838', h: '#9a6a1e', H: '#4b2c12',
  };
  // night set for every world tone (the car, hair and vapor are drawn after the fade and keep their colours)
  const NIGHTC = {
    s1: '#0a0405', s2: '#13070a', s3: '#1f0b0e', s4: '#2e1013', hz: '#3e1618', p: '#13070a', p2: '#13070a',
    f0: '#4a1a14', f1: '#38120e', f2: '#2a0d0a', hl: '#6a2416', r: '#521a10', R: '#3a110a', RR: '#2a0b06',
    k: '#1a0806', c: '#ecd6bb', cs: '#b89c80', b: '#f1dcc0', b2: '#b08870', dl: '#6a2a1a',
  };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RGB = {}; for (const k in PAL) RGB[k] = hex(PAL[k]);
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const lerpC = (a, b, t) => [0, 1, 2].map(i => Math.round(a[i] + (b[i] - a[i]) * t));
  // night: the same five tones, faded in steps toward a maroon-to-black sky (the hero and hair keep their colours)
  const NIGHT = {}; for (const k in NIGHTC) NIGHT[k] = hex(NIGHTC[k]);
  const NSTEP = 7;
  let nightMix = 0;
  // ---------- pixel grids ----------
  function grid(w, h) { return Array.from({ length: h }, () => new Array(w).fill(null)); }
  function outline(g, ch, onlySet) {
    const h = g.length, w = g[0].length, out = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!g[y][x] || (onlySet && !onlySet.has(g[y][x]))) continue;
      const e = (yy, xx) => yy < 0 || xx < 0 || yy >= h || xx >= w || !g[yy][xx];
      if (e(y - 1, x) || e(y + 1, x) || e(y, x - 1) || e(y, x + 1)) out.push([x, y]);
    }
    for (const [x, y] of out) g[y][x] = ch;
  }
  function cropTop(g) { let t = 0; while (t < g.length - 1 && g[t].every(v => !v)) t++; return g.slice(t); }
  // collision boxes: horizontal bands of the silhouette, inset to be slightly forgiving
  function autoBoxes(g, band = 5, inset = 2) {
    const boxes = [];
    for (let y0 = 0; y0 < g.length; y0 += band) {
      let mn = 1e9, mx = -1;
      const y1 = Math.min(g.length, y0 + band);
      for (let y = y0; y < y1; y++) for (let x = 0; x < g[0].length; x++) if (g[y][x]) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
      if (mx < 0 || mx - mn < 2 * inset + 1) continue;
      const top = y0 === 0 ? 1 : y0;
      boxes.push([mn + inset, top, mx - mn + 1 - 2 * inset, y1 - top]);
    }
    return boxes;
  }
  const CACHE = new Map();
  function bake(key, g) {
    if (CACHE.has(key)) return CACHE.get(key);
    const h = g.length, w = g[0].length;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x2 = cv.getContext('2d'), img = x2.createImageData(w, h), d = img.data;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const ch = g[y][x]; if (!ch) continue;
      const c = RGB[ch] || hex(ch), i = (y * w + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
    x2.putImageData(img, 0, 0);
    const out = { w, h, c: cv };
    CACHE.set(key, out);
    return out;
  }

  // ---------- hero: low two-seat electric roadster (lime, our own detailing) ----------
  const TRW = 80, TRH = 27, WHEELS = [16, 62], WCY = 20, WR = 6.6, NOZ = [34, 46], SILL0 = 20, LAMP_ROW = 16;
  function topAt(x) {                                       // standing body/cabin profile
    if (x <= 1) return 12;
    if (x <= 22) return 11;                                // short tail deck
    if (x <= 30) return Math.round(11 - (x - 22) * 6 / 8); // fastback rear glass
    if (x <= 41) return 5;                                 // low removable roof
    if (x <= 52) return Math.round(5 + (x - 41) * 7 / 11); // raked windshield
    if (x <= 75) return Math.round(12 + (x - 52) * 3 / 23); // long low nose
    return 15 + (x - 75);
  }
  function buildTruck({ phase = 0, squat = 0, duck = false, thrust = false, dead = false, lamp = true, white = false }) {
    const g = grid(TRW, TRH);
    const sill = Math.min(SILL0 + squat, TRH - 1);
    const top = x => (duck && x >= 23 && x <= 52 ? Math.max(topAt(x), 8) : topAt(x)) + squat;
    const set = (y, x, c) => { if (y >= 0 && y < TRH && x >= 0 && x < TRW) g[y][x] = c; };
    for (let x = 1; x <= 78; x++) for (let y = top(x); y <= sill; y++) {
      if (y === sill && (x <= 2 || x >= 77)) continue;
      const d = y - top(x);
      g[y][x] = d <= 1 ? 'V' : d <= 3 ? 'A' : d <= 5 ? 'a' : d <= 7 ? 'd' : 'D';
    }
    // wheel arches (wheels sit flush)
    for (const cx of WHEELS) for (let y = 0; y < TRH; y++) for (let x = 0; x < TRW; x++) if (Math.hypot(x - cx, y - WCY) < WR + 1.4 && y > top(x) + 3) g[y][x] = null;
    outline(g, 'o');
    // dark glass with a black targa roof panel
    const belt = 11 + squat;
    for (let x = 24; x <= 51; x++) for (let y = top(x) + 1; y < belt; y++) {
      if (!g[y][x] || g[y][x] === 'o') continue;
      g[y][x] = y === top(x) + 1 ? 'Q' : 'q';
      if (!dead && ((x - y * 1.6 + 300) % 13) < 1.2) g[y][x] = 'G';
      if (x === 31) g[y][x] = 'O';
    }
    for (let x = 31; x <= 41; x++) set(top(x) + 1, x, 'O');
    if (dead) for (const [x, y] of [[36, 0], [37, 1], [38, 1], [39, 2], [44, 1], [45, 2], [46, 3]]) if (top(x) + 1 + y < belt) set(top(x) + 1 + y, x, 'N');
    // side detailing: crisp specular crease, side scoop, door cut
    for (let x = 4; x <= 74; x++) { const y = 14 + squat; if (g[y] && g[y][x] && g[y][x] !== 'o' && y > top(x) + 1) g[y][x] = 'V'; }
    for (let x = 22; x <= 29; x++) for (let y = 15 + squat; y <= 17 + squat; y++) if (g[y] && g[y][x] && g[y][x] !== 'o') g[y][x] = x === 22 || y === 15 + squat ? 'o' : 'D';
    for (let y = belt; y <= sill - 2; y++) if (g[y] && g[y][53] && g[y][53] !== 'o') g[y][53] = 'd';
    for (let x = 3; x <= 76; x++) for (const yy of [sill - 1, sill]) if (g[yy][x] && g[yy][x] !== 'o' && !WHEELS.some(cx => Math.abs(x - cx) < WR + 1.6)) g[yy][x] = 'O';
    for (let x = 2; x <= 9; x++) if (g[sill - 2][x] && g[sill - 2][x] !== 'o') g[sill - 2][x] = 'O';   // rear diffuser
    // slim headlight, thin red tail light
    for (let x = 73; x <= 76; x++) set(LAMP_ROW + squat, x, lamp ? 'X' : 'N');
    for (let x = 1; x <= 4; x++) set(12 + squat, x, 'Z');
    // belly air ports
    for (const nx of NOZ) {
      for (let dx = -2; dx <= 2; dx++) set(sill + 1, nx + dx, Math.abs(dx) === 2 ? 'o' : 'T');
      for (let dx = -1; dx <= 1; dx++) set(sill + 2, nx + dx, thrust ? (dx === 0 ? 'X' : 'N') : (dx === 0 ? 'o' : null));
    }
    // small wheels: tyre with tread notches, alloy rim with rotating spokes
    for (const cx of WHEELS) for (let y = WCY - 7; y <= WCY + 7; y++) for (let x = cx - 7; x <= cx + 7; x++) {
      if (y < 0 || y >= TRH) continue;
      const dx = x - cx, dy = y - WCY, rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      let ch = null;
      if (rr <= WR && rr > 4.6) {
        ch = rr > 5.8 ? 't' : 'T';
        if (rr > 5.9 && Math.floor(((ang / (Math.PI * 2)) * 14 + phase / 2 + 14)) % 2 === 0) ch = 'T';
      } else if (rr <= 4.6 && rr > 1.2) {
        ch = rr > 3.8 ? 'N' : 'n';
        for (let i = 0; i < 5; i++) { const a = phase * Math.PI / 10 + i * Math.PI * 2 / 5; const px = Math.cos(a), py = Math.sin(a); const along = dx * px + dy * py, perp = Math.abs(-dx * py + dy * px); if (along > 0.8 && along < 4 && perp < 0.7) ch = 'N'; }
      } else if (rr <= 1.2) ch = 'o';
      if (ch && (!g[y][x] || g[y][x] === 'o' || rr <= WR)) g[y][x] = ch;
    }
    if (white) for (let y = 0; y < TRH; y++) for (let x = 0; x < TRW; x++) if (g[y][x]) g[y][x] = (g[y][x] === 'o' || g[y][x] === 't') ? 'k' : 'x';
    return g;
  }
  const truckSprite = o => bake('car' + JSON.stringify(o), cropTop(buildTruck(o)));
  const STAND_G = buildTruck({}), STAND_C = cropTop(STAND_G);
  const DUCK_G = cropTop(buildTruck({ squat: 6, duck: true }));
  const STAND_H = STAND_C.length, DUCK_H = DUCK_G.length;
  const CROP = TRH - STAND_H;                       // rows cropped from the top of the standing sprite
  const NOZ_TIP = SILL0 + 2 - CROP;                 // belly port row inside the standing sprite
  const HERO_BOX = autoBoxes(STAND_C, 5, 2), DUCK_BOX = autoBoxes(DUCK_G, 5, 2);

  // ---------- obstacles (ink style) ----------
  function coneGrid(h = 26, collars = []) {
    const w = 18, g = grid(w, h), base = h - 3;
    for (let y = 0; y < base; y++) {
      let hw = 1.3 + (y / (base - 1)) * 6.2;
      if (collars.some(r => y >= r && y < r + 2)) hw += 1.5;
      for (let x = 0; x < w; x++) if (Math.abs(x - 8.5) <= hw) g[y][x] = 'k';
    }
    for (let y = base; y < h; y++) for (let x = 0; x < w; x++) g[y][x] = 'k';
    const bands = h > 30 ? [Math.round(base * 0.3), Math.round(base * 0.64)] : [Math.round(base * 0.36), Math.round(base * 0.66)];
    for (const sy of bands) for (let y = sy; y < sy + 2; y++) for (let x = 0; x < w; x++) {
      const hw = 1.3 + (y / (base - 1)) * 6.2;
      if (g[y][x] && Math.abs(x - 8.5) < hw - 1) g[y][x] = 'w';
    }
    for (let x = 1; x < w - 1; x++) g[base][x] = 'g';
    return g;
  }
  function barrierGrid() {
    const w = 30, h = 22, g = grid(w, h);
    for (let y = 0; y < 9; y++) for (let x = 0; x < w; x++) {
      if (y === 0 && (x === 0 || x === w - 1)) continue;
      g[y][x] = 'k';
      if (y >= 2 && y <= 6 && x >= 2 && x <= w - 3 && ((x + y) % 8 < 3)) g[y][x] = 'w';
    }
    for (const lx of [4, 24]) for (let y = 9; y < h; y++) for (let x = lx; x < lx + 2; x++) g[y][x] = 'k';
    for (const lx of [1, 21]) for (let y = h - 2; y < h; y++) for (let x = lx; x < lx + 8; x++) g[y][x] = 'k';
    for (let x = 4; x <= 25; x++) g[13][x] = 'k';
    g[1][3] = 'g'; g[1][4] = 'g'; g[1][25] = 'g'; g[1][26] = 'g';
    return g;
  }
  function drumGrid() {
    const w = 24, h = 32, g = grid(w, h);
    for (let y = 2; y < h - 2; y++) for (let x = 0; x < w; x++) {
      const hw = 9 + (y > 4 ? 1 : 0) + (y > 6 ? 1 : 0);
      if (Math.abs(x - 11.5) <= hw) g[y][x] = 'k';
    }
    for (let y = 0; y < 2; y++) for (let x = 7; x <= 16; x++) g[y][x] = 'k';
    for (let y = h - 2; y < h; y++) for (let x = 0; x < w; x++) g[y][x] = 'k';
    for (const sy of [9, 17]) for (let y = sy; y < sy + 3; y++) for (let x = 2; x <= 21; x++) g[y][x] = 'w';
    for (let y = 4; y < h - 4; y++) if (g[y][17] === 'k') g[y][17] = 'g';
    return g;
  }
  // flying hairpiece: straw-blond swept pompadour on a dome, dark roots + lace fringe, and a comb-over flap that flaps
  const WIG_GW = 64, WIG_GH = 36, WIG_BOT = 31;      // WIG_BOT = lowest core row (fringe)
  function wigGrid(frame, coreOnly) {
    const w = WIG_GW, h = WIG_GH, g = grid(w, h);
    const inDome = (x, y) => (((x - 34) / 18) ** 2 + ((y - 29) / 9) ** 2 <= 1 && y <= 30);
    const inQuiff = (x, y) => Math.hypot(x - 18, (y - 21) * 1.1) <= 8 || Math.hypot(x - 11, y - 18) <= 4.5 || Math.hypot(x - 24, y - 18) <= 6;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inDome(x, y) || (inQuiff(x, y) && y <= 30)) g[y][x] = 'y';
    for (let x = 17; x <= 50; x += 2) if (g[30][x]) g[WIG_BOT][x] = 'y';
    // comb-over flap: a thick lock lifted off the crown, 4-frame flap (up, mid, flat, mid) — never below the dome
    if (!coreOnly) {
      const ang = [-0.95, -0.5, -0.12, -0.5][frame];
      for (let i = 0; i <= 40; i++) {
        const t = i / 40, ax = 38 + Math.cos(ang) * 22 * t, ay = 21 + Math.sin(ang) * 22 * t + Math.sin(t * Math.PI) * -2.5;
        const r = 2.8 * (1 - t) + 0.7;
        for (let yy = Math.floor(ay - r); yy <= Math.ceil(ay + r); yy++) for (let xx = Math.floor(ax - r); xx <= Math.ceil(ax + r); xx++)
          if (yy >= 0 && yy < h && xx >= 0 && xx < w && Math.hypot(xx - ax, yy - ay) <= r) g[yy][xx] = yy < ay - 0.5 ? 'Y' : 'y';
      }
    }
    outline(g, 'H');
    // strands: arc over the quiff, sweep back flat over the dome; light on top, dark roots at the bottom
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const c = g[y][x]; if (c !== 'y' && c !== 'Y') continue;
      const above = y > 0 && g[y - 1][x] === 'H';
      if (y >= 28 && inDome(x, y)) { g[y][x] = (x + y) % 3 === 0 ? 'H' : 'h'; continue; }
      const sv = y + 7 * Math.exp(-(((x - 18) / 9) ** 2)) - 0.12 * x;
      if (((Math.floor(sv * 0.7) % 3) + 3) % 3 === 0 && (x * 5 + y * 3) % 11 > 1) g[y][x] = 'h';
      else if (above || (y < 22 && (x + 2 * y) % 5 === 0)) g[y][x] = 'L';
      else if (y < 24) g[y][x] = 'Y';
    }
    for (let x = 17; x <= 50; x++) if (g[WIG_BOT][x]) g[WIG_BOT][x] = x % 2 ? 'H' : null;  // lace fringe
    // curl in the quiff front
    for (const [x, y] of [[10, 17], [11, 16], [12, 16], [13, 17], [13, 18], [12, 19], [11, 19]]) if (g[y][x]) g[y][x] = 'H';
    return g;
  }
  function creamify(g) {     // ink → cream body, background bands → dark bands, then a dark outline
    for (const row of g) for (let x = 0; x < row.length; x++) row[x] = row[x] === 'k' ? 'c' : row[x] === 'w' ? 'R' : row[x] === 'g' ? 'cs' : row[x];
    outline(g, 'k', new Set(['c', 'cs']));
    for (let y = 1; y < g.length; y++) for (let x = 1; x < g[0].length; x++) if (g[y][x] === 'c' && g[y][x - 1] && g[y][x - 1] !== 'k' && (x > g[0].length / 2 + 1) && g[y][x + 1] === 'k') g[y][x] = 'cs';
    return g;
  }
  const OB = {
    cone: creamify(coneGrid(26)), stack: creamify(coneGrid(38, [12, 23])), barrier: creamify(barrierGrid()), drum: creamify(drumGrid()),
    wig: [0, 1, 2, 3].map(f => wigGrid(f)),
  };
  const BOX = {
    cone: autoBoxes(OB.cone, 4, 1), stack: autoBoxes(OB.stack, 5, 1), barrier: autoBoxes(OB.barrier, 6, 1), drum: autoBoxes(OB.drum, 8, 1),
    wig: autoBoxes(wigGrid(0, true), 4, 2),
  };
  const TYPES = [
    { id: 'cone', w: 18, h: 26, minSpeed: 0, multiSpeed: 6.6, maxSize: 3, minGap: 120 },
    { id: 'stack', w: 18, h: 38, minSpeed: 0, multiSpeed: 8, maxSize: 2, minGap: 120 },
    { id: 'barrier', w: 30, h: 22, minSpeed: 6.4, multiSpeed: 99, maxSize: 1, minGap: 130 },
    { id: 'drum', w: 24, h: 32, minSpeed: 0, multiSpeed: 9, maxSize: 2, minGap: 120 },
    { id: 'wig', w: 64, h: 36, minSpeed: 0, multiSpeed: 999, maxSize: 1, minGap: 150, flying: true },
  ];
  const WIG_Y = [GROUND - 18 - WIG_BOT, GROUND - 40 - WIG_BOT]; // duck-under (clear gap above the squatted car), high pass — never a jump

  // clouds: light-grey outline, background fill (like the original)
  function cloudGrid(seed) {
    const r = mulberry(seed), w = 46, h = 14, g = grid(w, h);
    const bumps = [[10, 9, 5], [20, 6, 6], [30, 8, 5], [37, 10, 4]].map(([x, y, rr]) => [x + Math.floor(r() * 3) - 1, y, rr + Math.floor(r() * 2)]);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (y >= h - 3 && x >= 4 && x <= 42) { g[y][x] = 'w'; continue; }
      if (bumps.some(([bx, by, br]) => Math.hypot(x - bx, (y - by) * 1.1) <= br)) g[y][x] = 'w';
    }
    outline(g, 'l');
    return g;
  }

  // 5x7 pixel font for HUD, drawn at 2x
  const FONT = {
    '0': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    '3': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    '5': ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    '6': ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    '7': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    '9': ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
    'H': ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'I': ['.###.', '..#..', '..#..', '..#..', '..#..', '..#..', '.###.'],
    'G': ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    'A': ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    'M': ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    'E': ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    'O': ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'V': ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    'R': ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    'F': ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    'L': ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    'P': ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    '+': ['.....', '..#..', '..#..', '#####', '..#..', '..#..', '.....'],
  };

  // ---------- canvas & layout ----------
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  const vbuf = document.createElement('canvas');
  const vctx = vbuf.getContext('2d');
  const msg = document.getElementById('msg');
  const hint = document.getElementById('hint');
  let W = 480, scale = 3, HUDM = 10;
  const tiles = { w: 0 };

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const aw = window.innerWidth * dpr, ah = window.innerHeight * dpr;
    const s = pickScale(aw, ah, H);
    W = Math.max(200, Math.min(1100, Math.floor(aw / s)));
    scale = s;
    HUDM = Math.max(8, Math.ceil(16 * dpr / s));
    buf.width = W; buf.height = H; vbuf.width = W; vbuf.height = H;
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    cv.style.width = (cv.width / dpr) + 'px';
    cv.style.height = (cv.height / dpr) + 'px';
    ctx.imageSmoothingEnabled = false;
    if (G) render(); // keep the frame visible after a resize (matters in ?rec=1, where nothing else redraws)
  }

  // ---------- world tiles: dithered sky, far red hills, filled rust ground with real craters ----------
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  const bay = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;
  function bakeGround() {
    // sky: four butterscotch bands with dithered seams, a hazy dust band just above the horizon
    const SKY = ['s1', 's2', 's3', 's4'], sk = grid(W, GROUND + 1);
    for (let y = 0; y <= GROUND; y++) for (let x = 0; x < W; x++) {
      const f = Math.min(3, (y / GROUND) * 3.6), i = Math.floor(f), tt = f - i;
      sk[y][x] = (i < 3 && tt > 0.6 && bay(x, y) < (tt - 0.6) / 0.4) ? SKY[i + 1] : SKY[i];
      const hzT = (y - (GROUND - 30)) / 30;
      if (hzT > 0 && bay(x, y) < hzT * 0.75) sk[y][x] = 'hz';
    }
    tiles.sky = bake('sky' + W + 'x' + H, sk);
    // far layer: big red rocky hills, flat mesas and crater-rim silhouettes, filled, with a lit rim and shaded slopes
    const FW = 1200, FH = 64, hgt = new Array(FW).fill(0), r = mulberry(SEED ^ 0xfa7);
    const bump = (cx, w, hh, kind) => {
      for (let x = Math.max(0, Math.floor(cx - w)); x < Math.min(FW, cx + w); x++) {
        const u = (x - cx) / w; let v;
        if (kind === 'mesa') v = Math.abs(u) < 0.6 ? 1 : Math.max(0, 1 - (Math.abs(u) - 0.6) / 0.4);
        else if (kind === 'crater') v = Math.max(0, 1 - u * u) * (0.55 + 0.45 * Math.min(1, Math.abs(u) / 0.55) ** 2);  // raised rim, dished middle
        else v = Math.max(0, Math.cos(u * Math.PI / 2)) ** 1.4;
        hgt[x] = Math.max(hgt[x], Math.round(hh * v + (r() < 0.25 ? 1 : 0)));
      }
    };
    for (let x = 0; x < FW; x += 70 + Math.floor(r() * 90)) bump(x, 50 + r() * 70, 16 + r() * 20, 'hill');
    bump(180, 80, 44, 'mesa'); bump(560, 130, 54, 'crater'); bump(820, 60, 34, 'mesa'); bump(1040, 90, 40, 'crater'); bump(380, 45, 28, 'hill');
    for (let i = 0; i < 40; i++) { const t = i / 40; hgt[FW - 40 + i] = Math.round(hgt[FW - 40 + i] * (1 - t) + hgt[i] * t); }
    const f = grid(FW, FH);
    for (let x = 0; x < FW; x++) {
      const hh = Math.min(FH - 1, hgt[x]); if (!hh) continue;
      const slope = hgt[(x + 2) % FW] - hgt[(x - 2 + FW) % FW];
      for (let y = FH - hh; y < FH; y++) {
        const d = y - (FH - hh);
        let c = 'f1';
        if (d === 0) c = 'f0';
        else if (slope < -1 && d < 8) c = bay(x, y) < 0.7 ? 'f2' : 'f1';     // right-facing slopes in shadow
        else if (slope > 1 && d < 4) c = 'f0';
        if (d > 6 && (y % 9 === 3) && bay(x, y) < 0.3) c = 'f2';            // strata
        f[y][x] = c;
      }
    }
    // distant habitat dome + antenna on the mesa
    const dx = 186, dy = FH - 44;
    for (let y = -6; y <= 0; y++) for (let x = -9; x <= 9; x++) if (Math.hypot(x, y * 1.4) <= 9) f[dy + y][dx + x] = y === -6 || Math.hypot(x, y * 1.4) > 8 ? 'f0' : 'f2';
    f[dy - 2][dx - 3] = 'hz'; f[dy - 2][dx + 2] = 'hz';
    for (let y = dy - 18; y < dy; y++) f[y][dx + 13] = 'f2';
    for (let x = dx + 11; x <= dx + 15; x++) f[dy - 18][x] = 'f2';
    f[dy - 19][dx + 13] = 'hl';
    tiles.far = bake('far' + SEED, f);
    // near ground: filled rust band, highlight edge, rover tracks, sunken craters with raised rims, rocks with shadows
    const GW = 1200, GH = H - GROUND + 2, g = grid(GW, GH), gr = mulberry(SEED ^ 0x51ed);
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (y < 2) continue;
      let c = 'r';
      if (y === 2) c = 'hl';
      else if (y === 3) c = bay(x, y) < 0.5 ? 'hl' : 'r';
      else if (y > GH * 0.55) c = bay(x, y) < (y - GH * 0.55) / (GH * 0.45) * 0.8 ? 'R' : 'r';
      g[y][x] = c;
    }
    const T0 = Math.round(GH * 0.62);
    for (const ty of [T0, T0 + 4]) for (let x = 0; x < GW; x++) if ((x >> 1) % 3 !== 0) { g[ty][x] = 'R'; g[ty + 1][x] = 'RR'; }  // rover tracks
    for (let x = 0; x < GW; x++) if ((x >> 1) % 3 === 0) { g[T0 - 1][x] = 'hl'; g[T0 + 3][x] = 'hl'; }
    const crater = (cx, cy, rx) => {
      const ry = Math.max(3, rx * 0.36);
      for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) for (let x = Math.floor(cx - rx - 3); x <= cx + rx + 3; x++) {
        if (y < 4 || y >= GH || x < 0 || x >= GW) continue;
        const u = (x - cx) / rx, v = (y - cy) / ry, d = Math.sqrt(u * u + v * v);
        if (d < 0.86) {                       // bowl: shadowed far (upper-left) wall, lit near wall
          const lit = u * 0.6 + v * 0.8;
          g[y][x] = lit < -0.2 ? (bay(x, y) < 0.7 ? 'RR' : 'R') : lit < 0.25 ? 'R' : (bay(x, y) < 0.5 ? 'r' : 'R');
        } else if (d < 1.12) {                // raised rim: lit top edge, shadowed lower edge
          g[y][x] = v < 0.1 ? 'hl' : (bay(x, y) < 0.6 ? 'R' : 'r');
        } else if (d < 1.35 && v > 0.2 && bay(x, y) < 0.35) g[y][x] = 'R';   // ejecta shadow
      }
    };
    let cx = 60;
    while (cx < GW - 60) { const rx = 9 + Math.floor(gr() * 20); crater(cx, 12 + rx * 0.4 + Math.floor(gr() * (GH - 24 - rx * 0.8)), rx); if (gr() < 0.5) crater(cx + rx + 30 + gr() * 40, 10 + Math.floor(gr() * 14), 4 + Math.floor(gr() * 4)); cx += 200 + Math.floor(gr() * 200); }
    for (let i = 0; i < 60; i++) {           // rocks and pebbles with a lit top and a shadow to the right
      const x = Math.floor(gr() * (GW - 6)), y = 5 + Math.floor(gr() * (GH - 8)), sz = gr() < 0.75 ? 1 : 2 + Math.floor(gr() * 2);
      if (g[y][x] === 'RR' || g[y][x] === 'R' && gr() < 0.5) continue;
      for (let yy = 0; yy < sz; yy++) for (let xx = 0; xx < sz + 1; xx++) if (y + yy < GH && x + xx < GW) g[y + yy][x + xx] = yy === 0 ? 'hl' : 'r';
      for (let xx = 1; xx <= sz + 1; xx++) if (y + sz < GH && x + xx < GW) g[y + sz][x + xx] = 'RR';
    }
    tiles.ground = bake('ground' + H + 'x' + SEED, g);
    tiles.w = W;
  }

  // ---------- audio ----------
  let AC = null, master = null;
  function audioInit() {
    if (AC || REC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.16; master.connect(AC.destination); } catch (e) { AC = null; }
  }
  function tone(f0, f1, dur, type = 'square', vol = 1, delay = 0) {
    if (!AC) return;
    const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, vol, f) {
    if (!AC) return;
    const n = Math.floor(AC.sampleRate * dur), bb = AC.createBuffer(1, n, AC.sampleRate), d = bb.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = AC.createBufferSource(), flt = AC.createBiquadFilter(), g = AC.createGain();
    flt.type = 'lowpass'; flt.frequency.value = f; g.gain.value = vol; src.buffer = bb; src.connect(flt); flt.connect(g); g.connect(master); src.start();
  }
  const SFX = {
    jump: () => { tone(360, 720, 0.07, 'square', 0.45); noise(0.09, 0.35, 2600); },
    point: () => { tone(988, 988, 0.07, 'square', 0.4); tone(1319, 1319, 0.11, 'square', 0.4, 0.075); },
    crash: () => { tone(200, 50, 0.32, 'square', 0.55); noise(0.35, 0.7, 1100); },
  };

  // ---------- hero physics (pure; shared by game and autopilot) ----------
  const GROUND_Y = GROUND + 1 - STAND_H;
  const FLIP_FRAMES = 27;   // ~0.45 s, 8 rotation steps of 45°
  const newHero = () => ({ y: GROUND_Y, vy: 0, jumping: false, reachedMin: false, released: false, speedDrop: false, ducking: false, flipT: -1, flipUsed: false, flipDone: false, flipCrash: false });
  function heroFlip(h) {
    if (!h.jumping || h.flipT >= 0 || h.flipUsed || h.speedDrop) return false;
    h.flipT = 0; h.flipUsed = true; h.vy = Math.max(h.vy - 3.4, -9.5);   // thrusters add a little extra air
    return true;
  }
  const flipAngle = h => h.flipT < 0 ? 0 : -Math.floor(h.flipT * 8 / FLIP_FRAMES) * Math.PI / 4;
  function heroJump(h, speed) {
    if (h.jumping || h.ducking) return false;
    h.flipT = -1; h.flipUsed = false; h.flipDone = false; h.flipCrash = false;
    h.jumping = true; h.reachedMin = false; h.released = false; h.speedDrop = false; h.vy = JUMP_V - speed / 10; return true;
  }
  function heroEndJump(h) { h.released = true; if (h.reachedMin && h.vy < DROP_V) h.vy = DROP_V; }
  function heroDuck(h, on) {
    if (on) { if (h.jumping) { if (!h.speedDrop && h.flipT < 0) { h.speedDrop = true; h.vy = 1; } } else h.ducking = true; }
    else { h.ducking = false; h.speedDrop = false; }
  }
  function heroStep(h) {
    if (!h.jumping) return false;
    if (h.flipT >= 0 && ++h.flipT >= FLIP_FRAMES) { h.flipT = -1; h.flipDone = true; }
    h.y += Math.round(h.speedDrop ? h.vy * DROP_COEF : h.vy);
    h.vy += GRAVITY;
    if (h.y < GROUND_Y - MIN_JUMP || h.speedDrop) h.reachedMin = true;
    if (h.y < GROUND_Y - MAX_JUMP || h.speedDrop || h.released) heroEndJump(h);
    if (h.y > GROUND_Y) { if (h.flipT >= 0) { h.flipCrash = true; h.flipT = -1; } h.y = GROUND_Y; h.jumping = false; h.vy = 0; h.reachedMin = false; const sd = h.speedDrop; h.speedDrop = false; if (sd) h.ducking = true; return true; }
    return false;
  }
  function heroBoxes(h) {
    if (h.flipT >= 0) {   // rotated bounding box of the car, shrunk to stay forgiving
      const a = flipAngle(h), c = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
      const bw = (c * HERO_W + sn * STAND_H) * 0.72, bh = (sn * HERO_W + c * STAND_H) * 0.72, cx = HERO_X + HERO_W / 2, cy = h.y + STAND_H / 2;
      return [[cx - bw / 2, cy - bh / 2, bw, bh]];
    }
    if (h.ducking && !h.jumping) { const oy = GROUND + 1 - DUCK_H; return DUCK_BOX.map(([x, y, w, hh]) => [HERO_X + x, oy + y, w, hh]); }
    return HERO_BOX.map(([x, y, w, hh]) => [HERO_X + x, h.y + y, w, hh]);
  }
  function obBoxes(o) {
    const out = [], base = BOX[o.type.id], sw = o.type.w;
    for (let i = 0; i < o.size; i++) for (const [x, y, w, hh] of base) out.push([o.x + i * sw + x, o.y + y, w, hh]);
    return out;
  }
  function hit(hb, ob) {
    for (const a of hb) for (const c of ob) if (a[0] < c[0] + c[2] && a[0] + a[2] > c[0] && a[1] < c[1] + c[3] && a[1] + a[3] > c[1]) return true;
    return false;
  }

  // ---------- game state ----------
  let G = null, simTime = 0, stepTime = 0;
  const EVENTS = [];
  const ev = k => EVENTS.push({ t: +simTime.toFixed(4), k });
  let hiScore = 0;
  try { hiScore = parseInt(localStorage.getItem('hopper.hi') || '0', 10) || 0; } catch (e) { hiScore = 0; }

  function newGame(intro) {
    G = {
      mode: intro ? 'intro' : 'play', frame: 0, playFrames: 0, deadFrames: 0, introFrames: 0,
      hero: newHero(), speed: SPEED0, dist: 0, bgDist: 0, score: 0, lastMilestone: 0,
      obstacles: [], lastTypes: [], parts: [], blobs: [], devils: [],
      night: false, nightFrames: 0, nextNight: NIGHT_EVERY, stars: [], moon: 0,
      flash: 0, jumpHeld: false, duckHeld: false, plan: null, squash: 0, shake: 0, boom: null,
      hitStop: 0, hitFlash: 0, knock: 0, knockV: 0, tilt: 0, jumpAge: 0, retro: 0, bonus: 0, popups: [], flipJet: 0, botGround: 0, botNextFlip: 2,
    };
    const r = mulberry(SEED ^ 0xc10d);
    G.devils.push({ x: 260 + r() * 150, h: 16 + Math.floor(r() * 8), ph: r() * 6 });
    makeStars();
  }
  function makeStars() {
    const r = mulberry(SEED ^ (G.nextNight * 7));
    G.stars = [];
    for (let i = 0; i < 26; i++) G.stars.push({ x: Math.floor(r() * 1100), y: 8 + Math.floor(r() * (GROUND - 90)), tw: Math.floor(r() * 120), big: r() < 0.2 });
  }
  function start() {
    if (G.mode !== 'intro') return; G.mode = 'play'; G.playFrames = 0; doJump();
    if (BOT) { G.plan = { kind: 'jump', hold: 60, flip: 3, f: 0 }; }   // the bot always flips its first jump
  }
  function restart() { newGame(false); }
  // compressed-air vapor: metaball blobs rendered as a dithered pixel cloud with an ink outline
  function blob(x, y, vx, vy, r0, r1, grow, max, dens, kind = 'vapor', drift = 0.3) {
    G.blobs.push({ x, y, vx, vy, r0, r1, grow, max, dens, kind, drift, age: 0 });
  }
  // ground-level billows sit behind the car so its silhouette always reads; jets and crash puffs draw in front
  const billow = (x, y, vx, vy, r0, r1, grow, max, dens) => blob(x, y, vx, vy, r0, r1, grow, max, dens, 'billow');
  function hopBurst() {
    const base = GROUND - 2, cx = HERO_X + (NOZ[0] + NOZ[1]) / 2;
    for (const nx of NOZ) {
      const x = HERO_X + nx;
      billow(x, base - 7, 0, 1.4, 3, 8, 4, 22, 1.5);                        // jets slamming into the ground
      billow(x, base - 2, 0, 0.3, 4, 10, 5, 34, 1.4);
    }
    // the main billow: a cluster of overlapping puffs so the outline reads as one lumpy cloud
    for (let i = 0; i < 7; i++) {
      const ox = (i - 3) * 6 + (fxRng() - 0.5) * 4;
      billow(cx + ox, base - 2 - fxRng() * 6, ox * 0.09, -0.25 - fxRng() * 0.45, 4, 11 + fxRng() * 7, 8 + fxRng() * 4, 50 + fxRng() * 18, 1.25);
    }
    for (let i = 0; i < 6; i++) {                                          // ground-hugging roll-out both ways
      const dir = i % 2 ? 1 : -1, sp = 0.9 + fxRng() * 1.4;
      billow(cx + dir * (12 + fxRng() * 8), base - 1, dir * sp, -0.1 - fxRng() * 0.2, 3, 8 + fxRng() * 5, 9, 40 + fxRng() * 18, 1.1);
    }
    for (let i = 0; i < 3; i++) billow(cx - 12 + fxRng() * 24, base - 12, -0.4 + fxRng() * 0.8, -0.5 - fxRng() * 0.4, 3, 7 + fxRng() * 4, 10, 40, 0.95);
  }
  // straight down out of the belly: a column of puffs from the ports to the ground, plus an outward roll at the ground
  function jetColumn(top, dens) {
    for (const nx of NOZ) {
      const x = HERO_X + nx;
      for (let yy = top + 1; yy < GROUND - 3; yy += 4) blob(x + (fxRng() - 0.5), yy, 0, 0.6, 3, 5 + (yy - top) * 0.06, 3, 7, dens, 'vapor', 0);
      const dir = fxRng() < 0.5 ? -1 : 1;
      billow(x + dir * 3, GROUND - 3, dir * (1 + fxRng() * 1.6), -0.15, 4, 9 + fxRng() * 4, 6, 30 + fxRng() * 10, 1.2);
    }
  }
  function doFlip() {
    if (!heroFlip(G.hero)) return;
    ev('flip'); G.flipJet = 6; G.retro = 0;
    if (AC) { tone(260, 520, 0.12, 'square', 0.35); noise(0.14, 0.4, 3000); }
  }
  function doJump() {
    if (G.mode === 'play' && G.hero.jumping) { doFlip(); return; }   // second tap while airborne = backflip
    if (heroJump(G.hero, G.speed)) {
      G.jumpAge = 0; G.retro = 0;
      SFX.jump(); ev('jump');
      hopBurst();
    }
  }
  function part(x, y, vx, vy, life, color, size, grav = 0) { G.parts.push({ x, y, vx, vy, life: 0, max: life, color, size, grav }); }

  // ---------- input ----------
  function pressJump() {
    audioInit();
    if (G.mode === 'intro') { start(); G.jumpHeld = true; return; }
    if (G.mode === 'over') { if (G.deadFrames > 36) restart(); return; }
    G.jumpHeld = true; doJump();
  }
  function releaseJump() { G.jumpHeld = false; if (G.mode === 'play' && G.hero.jumping) heroEndJump(G.hero); }
  function pressDuck() { audioInit(); if (G.mode !== 'play') return; G.duckHeld = true; const was = G.hero.ducking; heroDuck(G.hero, true); if (G.hero.ducking && !was) ev('duck'); }
  function releaseDuck() { G.duckHeld = false; if (G.mode === 'play') heroDuck(G.hero, false); }

  window.addEventListener('keydown', e => {
    if (e.repeat) { if ([' ', 'ArrowUp', 'ArrowDown'].includes(e.key)) e.preventDefault(); return; }
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); pressJump(); }
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); pressDuck(); }
    else if (e.key === 'Enter' && G.mode === 'over') pressJump();
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') releaseJump();
    else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') releaseDuck();
  });
  {
    let tStart = null, tTimer = 0, tJumped = false, tDucked = false;
    const fireJump = () => { if (tStart && !tJumped && !tDucked) { tJumped = true; pressJump(); } };
    window.addEventListener('touchstart', e => {
      e.preventDefault();
      const t = e.changedTouches[0]; tStart = { x: t.clientX, y: t.clientY }; tJumped = false; tDucked = false;
      if (G.mode !== 'play') { fireJump(); return; }
      clearTimeout(tTimer); tTimer = setTimeout(fireJump, 55);
    }, { passive: false });
    window.addEventListener('touchmove', e => {
      e.preventDefault(); if (!tStart) return;
      const dy = e.changedTouches[0].clientY - tStart.y;
      if (dy > 18 && !tDucked) { clearTimeout(tTimer); tDucked = true; if (tJumped) releaseJump(); pressDuck(); }
      else if (dy < -14) fireJump();
    }, { passive: false });
    window.addEventListener('touchend', e => {
      e.preventDefault(); clearTimeout(tTimer);
      if (!tJumped && !tDucked) fireJump();
      if (tJumped) releaseJump();
      if (tDucked) releaseDuck();
      tStart = null;
    }, { passive: false });
    window.addEventListener('mousedown', e => { if (e.button === 0) pressJump(); });
    window.addEventListener('mouseup', e => { if (e.button === 0) releaseJump(); });
  }

  // ---------- obstacles ----------
  function addObstacle() {
    const wigOk = G.playFrames > WIG_AFTER;
    const avail = TYPES.filter(t => t.minSpeed <= G.speed && (!t.flying || wigOk) &&
      !(G.lastTypes.length >= 2 && G.lastTypes.every(id => id === t.id)) && !(t.flying && G.lastTypes[G.lastTypes.length - 1] === 'wig' && G.speed < 9));
    let type = avail[rint(0, avail.length - 1)];
    if (wigOk && !G.firstWig && avail.some(t => t.flying)) { type = TYPES[4]; G.firstWig = true; }
    const size = G.speed >= type.multiSpeed ? rint(1, type.maxSize) : 1;
    const w = type.w * size, h = type.h;
    const y = type.flying ? WIG_Y[G.firstWig === true ? (G.firstWig = 'done', 0) : rint(0, 1)] : GROUND + 1 - h;
    const minGap = Math.round(w * G.speed + type.minGap * GAP_COEF);
    const gap = rint(minGap, Math.round(minGap * MAX_GAP_COEF));
    G.obstacles.push({ type, size, x: W, y, w, h, gap, off: type.flying ? (rng() < 0.5 ? -0.8 : 0.8) : 0, followed: false, anim: rint(0, 30) });
    G.lastTypes.push(type.id); if (G.lastTypes.length > 2) G.lastTypes.shift();
  }

  // ---------- autopilot ----------
  // Predicts with the real hero physics and acts as late as is comfortably safe.
  const POLICIES = [];
  [1, 4, 8, 12, 18, 60].forEach(k => POLICIES.push({ kind: 'jump', hold: k }));
  [16, 20, 24, 28].forEach(d => POLICIES.push({ kind: 'jump', hold: 60, drop: d }));
  [[60, 3], [60, 6], [60, 9], [18, 4], [12, 6], [60, 12]].forEach(([k, fl]) => POLICIES.push({ kind: 'jump', hold: k, flip: fl }));
  POLICIES.push({ kind: 'duck' });
  function simulate(delay, pol, horizon, tIdx) {
    const h = Object.assign({}, G.hero);
    const obs = G.obstacles.map(o => ({ o, x: o.x }));
    let speed = G.speed, duckUntil = -1, activeUntil = pol ? 1e9 : -1, releaseDuckAt = -1;
    if (pol && pol.kind === 'duck') {
      const th = obs[tIdx];
      if (!th) return { safe: true, t: horizon };
      let fr = 0, x = th.x, sp = speed; while (x + th.o.w > HERO_X - 2 && fr < 300) { sp = Math.min(SPEED_MAX, sp + ACCEL); x -= sp + th.o.off; fr++; }
      duckUntil = delay + fr + 1; activeUntil = duckUntil;
    }
    for (let f = 0; f < horizon; f++) {
      if (f === releaseDuckAt) heroDuck(h, false);
      if (pol && f === delay) {
        if (pol.kind === 'jump') { if (!heroJump(h, speed)) return { safe: false, t: f }; }
        else heroDuck(h, true);
      }
      if (pol && pol.kind === 'jump' && f === delay + pol.hold) heroEndJump(h);
      if (pol && pol.drop && f === delay + pol.drop) heroDuck(h, true);
      if (pol && pol.flip && f === delay + pol.flip && !heroFlip(h)) return { safe: false, t: f };
      if (pol && pol.kind === 'duck' && f === duckUntil) heroDuck(h, false);
      const landed = heroStep(h);
      if (landed && h.flipCrash) return { safe: false, t: f };
      if (landed && pol && pol.kind === 'jump' && f > delay) { activeUntil = f; if (h.ducking) releaseDuckAt = f + 1; }
      speed = Math.min(SPEED_MAX, speed + ACCEL);
      const hb = heroBoxes(h);
      for (let i = 0; i < obs.length; i++) {
        const q = obs[i];
        q.x -= speed + q.o.off;
        if (pol && i > tIdx && f > activeUntil) continue;
        if (q.x > HERO_X + HERO_W + 4 || q.x + q.o.w < HERO_X - 4) continue;
        if (hit(hb, obBoxes({ type: q.o.type, size: q.o.size, x: q.x, y: q.o.y }))) return { safe: false, t: f, idx: i };
      }
      if (pol && f > activeUntil && f > delay + 2 && obs[tIdx].x + obs[tIdx].o.w < HERO_X - 4) return { safe: true, t: f };
    }
    return { safe: true, t: horizon };
  }
  const safeAt = (delay, tIdx) => POLICIES.filter(p => simulate(delay, p, 160, tIdx).safe);
  function botThink() {
    const h = G.hero;
    if (G.plan) {
      const p = G.plan; p.f++;
      if (p.kind === 'jump') {
        if (p.f === p.hold) releaseJump();
        if (p.drop && p.f === p.drop) pressDuck();
        if (p.flip && p.f === p.flip) pressJump();
        if (!h.jumping && p.f > 1) { if (G.duckHeld) releaseDuck(); if (G.jumpHeld) releaseJump(); G.plan = null; }
      } else if (p.kind === 'duck') { if (p.f >= p.until) { releaseDuck(); G.plan = null; } }
      if (G.plan || h.jumping) return;
    }
    if (h.jumping) return;
    const free = simulate(0, null, 90, 0);
    if (free.safe) return;
    const tIdx = free.idx, target = G.obstacles[tIdx];
    if (target.botMargin === undefined) { const r = botRng(); target.botMargin = r < 0.45 ? 1 : r < 0.75 ? 2 : r < 0.9 ? 3 : 5; }
    let options = safeAt(0, tIdx);
    if (!options.length) {
      if (free.t > 2) return;
      options = [POLICIES.reduce((a, p) => simulate(0, p, 160, tIdx).t > simulate(0, a, 160, tIdx).t ? p : a, POLICIES[0])];
    } else if (safeAt(target.botMargin, tIdx).length) return;
    const duck = options.find(p => p.kind === 'duck');
    let pick;
    if (duck && (target.type.flying || options.length === 1)) pick = duck;
    else {
      // backflip over roughly every 2nd–3rd ground obstacle when a flip line is safe
      if (target.wantFlip === undefined) { G.botGround = (G.botGround || 0) + 1; target.wantFlip = !target.type.flying && G.botGround >= G.botNextFlip; }
      const flips = target.wantFlip ? options.filter(p => p.flip) : [];
      const jumps = options.filter(p => p.kind === 'jump' && !p.drop && !p.flip);
      if (flips.length) { pick = flips[0]; G.botGround = 0; G.botNextFlip = 2 + (botRng() < 0.5 ? 1 : 0); }
      else pick = jumps.length ? jumps[Math.min(jumps.length - 1, botRng() < 0.7 ? 0 : 1)] : options[0];
    }
    G.plan = Object.assign({ f: 0 }, pick);
    if (pick.kind === 'jump') { pressJump(); if (pick.hold <= 0) releaseJump(); }
    else {
      let fr = 0, x = target.x, sp = G.speed; while (x + target.w > HERO_X - 2 && fr < 300) { sp = Math.min(SPEED_MAX, sp + ACCEL); x -= sp + target.off; fr++; }
      G.plan.until = fr + 1; pressDuck();
    }
  }

  // ---------- update ----------
  function tick() {
    simTime += STEP;
    G.frame++;
    const nt = G.night ? 1 : 0;
    nightMix += Math.sign(nt - nightMix) * Math.min(Math.abs(nt - nightMix), 1 / 36);
    if (G.hitStop > 0) { G.hitStop--; return; }      // crash hit-stop
    if (G.shake > 0) G.shake--;
    if (G.hitFlash > 0) G.hitFlash--;
    if (G.boom) G.boom.f++;
    const h = G.hero;
    if (G.mode === 'intro') {
      G.introFrames++;
      if (BOT && G.introFrames >= 60) start();
      updateParts(0); updateBlobs(0);
      return;
    }
    if (G.mode === 'over') {
      G.deadFrames++;
      // small bounce + knock-back, then a lingering leak from the nozzles
      if (h.y < GROUND_Y || h.vy < 0) {
        h.y += h.vy; h.vy += GRAVITY;
        if (h.y >= GROUND_Y) { h.y = GROUND_Y; if (h.vy > 2) { h.vy = -h.vy * 0.3; landDust(0.6); } else h.vy = 0; }
      }
      G.knock += G.knockV; G.knockV *= 0.8;
      G.tilt += ((h.y < GROUND_Y - 1 ? -0.2 : 0) - G.tilt) * 0.22;
      if (G.deadFrames % 10 === 0 && G.deadFrames < 110) blob(HERO_X + G.knock + NOZ[(G.deadFrames / 10) % 2], GROUND - 4, -0.3, -0.5, 2, 6, 10, 40, 0.75, 'vapor', 0);
      updateParts(0); updateBlobs(0);
      if (BOT && G.deadFrames > 110) restart();
      return;
    }
    G.playFrames++;
    if (BOT) botThink();
    // take-off jet column, retro-burst just before touchdown, faint wisp in between
    if (h.jumping) {
      G.jumpAge++;
      const belly = h.y + NOZ_TIP;
      if (G.jumpAge <= 9) jetColumn(belly, 1.4);
      if (G.flipJet > 0) { G.flipJet--; for (let i = 0; i < 3; i++) blob(HERO_X + 40 + (fxRng() - 0.5) * 30, h.y + STAND_H / 2 + (fxRng() - 0.5) * 12, (fxRng() - 0.5) * 1.6, 1.6 + fxRng(), 3, 7 + fxRng() * 3, 4, 18, 1.3, 'vapor', 0.3); }
      else if (!G.retro && h.flipT < 0 && h.vy > 0 && GROUND_Y - h.y < 24 + h.vy * 2) G.retro = 7;
      if (G.retro > 1) { G.retro--; jetColumn(belly, 1.25); }
      else if (G.jumpAge > 9 && G.playFrames % 2 === 0) for (const nx of NOZ) blob(HERO_X + nx, belly + 2, -0.2, 1.0, 1.5, 4, 6, 14, 0.85, 'wisp');
    }
    const landed = heroStep(h);
    if (h.flipDone) { h.flipDone = false; G.bonus += 50; G.popups.push({ x: HERO_X + 22, y: Math.round(h.y) - 14, f: 0 }); ev('flip50'); if (AC) tone(1175, 1568, 0.12, 'square', 0.35); }
    if (landed && h.flipCrash) { h.flipCrash = false; gameOver({ x: HERO_X + 44 }); return; }   // landed mid-rotation
    if (landed) {
      if (!G.duckHeld) h.ducking = false;
      G.squash = 7; G.retro = 0;
      landDust(1);
    }
    if (G.squash > 0) G.squash--;
    if (!h.jumping && G.playFrames % 7 === 0) part(HERO_X + 8, GROUND - 1, -G.speed * 0.3 - fxRng(), -0.8 - fxRng() * 0.8, 18, fxRng() < 0.5 ? 'ink' : 'grey', 1, 0.12);

    if (G.playFrames > 20) G.speed = Math.min(SPEED_MAX, G.speed + ACCEL);
    const sp = G.speed;
    G.dist += sp; G.bgDist += sp;

    if (G.playFrames > CLEAR_FRAMES) {
      const last = G.obstacles[G.obstacles.length - 1];
      if (!last) addObstacle();
      else if (!last.followed && last.x + last.w + last.gap < W) { last.followed = true; addObstacle(); }
    }
    for (const o of G.obstacles) { o.x -= sp + o.off; o.anim++; }
    G.obstacles = G.obstacles.filter(o => o.x + o.w > -10);

    const hb = heroBoxes(h);
    for (const o of G.obstacles) {
      if (o.x > HERO_X + HERO_W + 4 || o.x + o.w < HERO_X) continue;
      if (hit(hb, obBoxes(o))) { gameOver(o); return; }
    }

    const sc = Math.floor(G.dist * SCORE_COEF) + G.bonus;
    if (sc !== G.score) {
      const m = Math.floor(sc / 100) * 100;
      G.score = sc;
      if (m > 0 && m > G.lastMilestone) { G.lastMilestone = m; G.flash = 60; SFX.point(); ev('point100'); }
      if (sc >= G.nextNight) { G.nextNight += NIGHT_EVERY; G.night = true; G.nightFrames = NIGHT_FRAMES; G.moon = (G.moon + 1) % 4; makeStars(); }
    }
    if (G.flash > 0) G.flash--;
    for (const pu of G.popups) pu.f++;
    G.popups = G.popups.filter(pu => pu.f < 60);
    if (G.night) { G.nightFrames--; if (G.nightFrames <= 0) G.night = false; }

    for (const dv of G.devils) { dv.x -= sp * 0.1 + 0.15; dv.ph += 0.25; }
    G.devils = G.devils.filter(dv => dv.x > -20);
    if (!G.devils.length && fxRng() < 0.004) G.devils.push({ x: W + 10, h: 14 + Math.floor(fxRng() * 12), ph: 0 });
    updateParts(sp); updateBlobs(sp);
  }
  function landDust(k) {
    for (const wx of WHEELS) for (const dir of [-1, 1]) blob(HERO_X + G.knock + wx + dir * 3, GROUND - 2, dir * (1 + fxRng() * 1.6) * k, -0.25, 2, (5 + fxRng() * 3) * (0.6 + 0.4 * k), 6, 26, 1, 'dust', 0.35);
    if (k >= 1) billow(HERO_X + (NOZ[0] + NOZ[1]) / 2, GROUND - 3, 0, -0.2, 3, 9, 8, 28, 0.95);
    if (k >= 1) for (let i = 0; i < 6; i++) { const dir = i % 2 ? 1 : -1; billow(HERO_X + 40 + dir * (14 + fxRng() * 14), GROUND - 2, dir * (1.2 + fxRng() * 1.8), -0.2, 3, 7 + fxRng() * 5, 7, 34 + fxRng() * 12, 1.15); }
    for (let i = 0; i < 5 * k; i++) part(HERO_X + 6 + fxRng() * 70, GROUND - 1, (fxRng() - 0.5) * 2.6, -1 - fxRng() * 1.4, 22, fxRng() < 0.6 ? 'ink' : 'grey', 1, 0.16);
  }
  function updateParts(sp) {
    for (const p of G.parts) { p.x += p.vx - sp * 0.1; p.y += p.vy; p.vy = p.vy * 0.95 + p.grav; p.vx *= 0.97; p.life++; if (p.grav && p.y > GROUND) { p.y = GROUND; p.vy *= -0.3; p.vx *= 0.6; } }
    G.parts = G.parts.filter(p => p.life < p.max);
  }
  const blobR = bl => bl.r0 + (bl.r1 - bl.r0) * (1 - Math.pow(1 - Math.min(1, bl.age / bl.grow), 3));
  const blobS = bl => bl.dens * (bl.age < bl.max * 0.4 ? 1 : Math.max(0, 1 - (bl.age - bl.max * 0.4) / (bl.max * 0.6)));
  function updateBlobs(sp) {
    for (const bl of G.blobs) {
      bl.age++; bl.x += bl.vx - sp * bl.drift; bl.y += bl.vy; bl.vx *= 0.92; bl.vy *= 0.9;
      const r = blobR(bl); if (bl.y > GROUND - r * 0.45) bl.y = GROUND - r * 0.45;
    }
    G.blobs = G.blobs.filter(bl => bl.age < bl.max);
  }
  function gameOver(o) {
    const h = G.hero;
    G.mode = 'over'; G.deadFrames = 0; G.plan = null; h.ducking = false;
    SFX.crash(); ev('crash');
    G.shake = 14; G.hitStop = 3; G.hitFlash = 2;
    const fa = flipAngle(h); h.flipT = -1;
    h.vy = Math.min(h.vy, 0) - 3.6; h.jumping = false; G.knockV = -1.6; G.knock = 0; G.tilt = fa ? (((fa % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI : -0.28;
    const cx = Math.max(HERO_X + HERO_W - 6, o.x + 4), cy = Math.min(h.y + 12, GROUND - 8);
    G.boom = { x: cx, y: cy, f: 0 };
    for (let i = 0; i < 5; i++) blob(cx - 6 + fxRng() * 10, cy + (fxRng() - 0.5) * 8, -0.5 - fxRng() * 1.5, -0.6 + fxRng() * 0.8, 3, 10 + fxRng() * 6, 7, 46 + fxRng() * 16, 1.2, 'vapor', 0);
    for (let i = 0; i < 4; i++) blob(HERO_X + (NOZ[0] + NOZ[1]) / 2 + (fxRng() - 0.5) * 30, GROUND - 3, (fxRng() - 0.5) * 3, -0.3, 3, 10 + fxRng() * 4, 8, 44, 1.1, 'vapor', 0);
    for (let i = 0; i < 6; i++) blob(cx - 20 + fxRng() * 40, GROUND - 2, (fxRng() - 0.5) * 3, -0.3, 2, 7 + fxRng() * 3, 7, 30, 1, 'dust', 0);
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI * fxRng(), v = 1.2 + fxRng() * 2.6;
      part(cx, cy, Math.cos(a) * v, Math.sin(a) * v - 0.8, 34 + fxRng() * 20, i % 3 ? 'ink' : 'grey', 1 + (fxRng() < 0.4 ? 1 : 0), 0.16);
    }
    if (G.score > hiScore) { hiScore = G.score; try { localStorage.setItem('hopper.hi', String(hiScore)); } catch (e) { /* storage unavailable */ } }
  }

  // ---------- render ----------
  const PCOL = { ink: PAL.RR, grey: PAL.hl };
  function text(str, x, y, color, sc = 2) {
    b.fillStyle = color;
    for (const ch of str) {
      const gl = FONT[ch];
      if (gl) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r][c] === '#') b.fillRect(x + c * sc, y + r * sc, sc, sc);
      x += 6 * sc;
    }
  }
  // night is the game's own palette fade: the five world tones step toward the night set (no wipe, no alpha dissolve)
  const nightT = () => Math.round(nightMix * (NSTEP - 1)) / (NSTEP - 1);
  const pack = c => (c[0] << 16) | (c[1] << 8) | c[2];
  const TONE = new Map(Object.keys(NIGHTC).map(k => [pack(RGB[k]), k]));
  // mid-fade warmth: push the in-between steps toward a rusty dusk instead of a grey midpoint
  function dusk(c, t) {
    const k = Math.sin(Math.PI * t), l = (c[0] + c[1] + c[2]) / 3, sat = 1 + 0.15 * k;
    return [Math.min(255, Math.max(0, Math.round(l + (c[0] - l) * sat + 8 * k))), Math.min(255, Math.max(0, Math.round(l + (c[1] - l) * sat - 2 * k))), Math.min(255, Math.max(0, Math.round(l + (c[2] - l) * sat - 4 * k)))];
  }
  function nightPass(t) {
    if (t <= 0) return;
    const img = b.getImageData(0, 0, W, H), d = img.data, M = {};
    for (const k in NIGHT) M[k] = dusk(lerpC(RGB[k], NIGHT[k], t), t);
    for (let i = 0; i < d.length; i += 4) {
      const tone = TONE.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]); if (!tone) continue;
      const c = M[tone]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2];
    }
    b.putImageData(img, 0, 0);
  }
  const VAPC = { k: hex('#9ea3a9'), g: hex('#c4bcb6'), l: hex('#ece8e4'), w: RGB.w, x: RGB.x };
  const DUSTC = { k: RGB.R, g: RGB.hl, l: RGB.dl, w: RGB.hz, x: RGB.dl };
  const vapor0 = kind => kind === 'dust' ? DUSTC : VAPC;
  function drawBlobs(kind, nightAware, ne) {
    const list = [];
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const bl of G.blobs) {
      if (bl.kind !== kind) continue;
      const r = blobR(bl), s = blobS(bl); if (s <= 0.02) continue;
      list.push([bl.x, bl.y, r, s, bl.dens]);
      x0 = Math.min(x0, bl.x - r); x1 = Math.max(x1, bl.x + r); y0 = Math.min(y0, bl.y - r); y1 = Math.max(y1, bl.y + r);
    }
    if (!list.length) return;
    x0 = Math.max(0, Math.floor(x0) - 1); x1 = Math.min(W - 1, Math.ceil(x1) + 1);
    y0 = Math.max(0, Math.floor(y0) - 1); y1 = Math.min(GROUND + 3, Math.ceil(y1) + 1);
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1; if (bw <= 0 || bh <= 0) return;
    const F = new Float32Array(bw * bh), Wt = new Float32Array(bw * bh);
    for (const [bx, by, r, s, dn] of list) {
      const ax = Math.max(x0, Math.floor(bx - r)), bx2 = Math.min(x1, Math.ceil(bx + r));
      const ay = Math.max(y0, Math.floor(by - r)), by2 = Math.min(y1, Math.ceil(by + r));
      for (let y = ay; y <= by2; y++) for (let x = ax; x <= bx2; x++) {
        const dx = x - bx, dy = (y - by) * 1.2, d2 = (dx * dx + dy * dy) / (r * r);
        if (d2 >= 1) continue;
        const w = (1 - d2) * (1 - d2), i = (y - y0) * bw + (x - x0);
        F[i] += s * w; Wt[i] += dn * w;
      }
    }
    const IN = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x, gx = x + x0, gy = y + y0;
      let f = F[i]; if (gy > GROUND) f *= Math.max(0, 1 - (gy - GROUND) / 4);
      if (f > 0.3 + ((BAYER[gy & 3][gx & 3] + 0.5) / 16) * 0.14) IN[i] = 1;
    }
    const img = vctx.createImageData(bw, bh), d = img.data;
    const vapor = kind !== 'dust', soft = kind === 'wisp';
    const C = vapor0(kind);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) {
      const i = y * bw + x; if (!IN[i]) continue;
      const gx = x + x0, gy = y + y0, th = (BAYER[gy & 3][gx & 3] + 0.5) / 16;
      const fade = Math.min(1, F[i] / Math.max(1e-3, Wt[i]));
      const edge = !(x > 0 && IN[i - 1]) || !(x < bw - 1 && IN[i + 1]) || !(y > 0 && IN[i - bw]) || !(y < bh - 1 && IN[i + bw]);
      let c;
      if (edge) c = th < fade * 1.5 ? (vapor && !soft ? C.k : C.g) : (vapor ? C.l : null);
      else {
        if (fade < 0.45 && th > fade * 2.2) continue;            // dissolve as it thins out
        const f = F[i], above = y >= 2 ? F[i - 2 * bw] : 0, below = y < bh - 2 ? F[i + 2 * bw] : 0;
        if (vapor) {
          c = f >= 1.0 ? C.x : (th < (f - 0.55) / 0.45 ? C.x : C.l);
          if (above - below > 0.16 && f < 1.25) c = th < 0.5 ? C.g : C.l;   // shaded underside
        } else c = th < 0.35 ? C.l : C.w;
      }
      if (!c) continue;
      const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    vctx.putImageData(img, 0, 0);
    b.drawImage(vbuf, 0, 0, bw, bh, x0, y0, bw, bh);
  }
  function drawSprite(sp, x, y) { b.drawImage(sp.c, Math.round(x), Math.round(y)); }
  function render() {
    if (tiles.w !== W || !tiles.ground) bakeGround();
    const t = nightT(), ne = null;
    const pageBg = css(dusk(lerpC(RGB.s1, NIGHT.s1, t), t));
    // the page continues the world: sky above the band, ground below it (matters on tall phone screens)
    const soil = css(dusk(lerpC(RGB.R, NIGHT.R, t), t)), gy = Math.round(cv.getBoundingClientRect().bottom);
    const bgCss = `linear-gradient(to bottom, ${pageBg} 0, ${pageBg} ${gy - 2}px, ${soil} ${gy - 2}px, ${soil} 100%)`;
    if (bgCss !== render.bg) { document.body.style.background = bgCss; render.bg = bgCss; }
    document.documentElement.style.setProperty('--fg', css(lerpC(RGB.b, NIGHT.b, t)));
    document.documentElement.style.setProperty('--muted', css(lerpC(hex('#7a4a30'), hex('#c09a80'), t)));

    const f = G.frame, h = G.hero;
    drawSprite(tiles.sky, 0, 0);
    // small pale-blue setting sun with a warm halo, low over the hills
    const sx0 = Math.round(W * 0.8), sy0 = GROUND - 44;
    for (let y = -9; y <= 9; y++) for (let x = -9; x <= 9; x++) {
      const dd = Math.hypot(x, y);
      if (dd <= 3.6) { b.fillStyle = PAL.p; b.fillRect(sx0 + x, sy0 + y, 1, 1); }
      else if (dd <= 8 && bay(sx0 + x, sy0 + y) < (8 - dd) / 6) { b.fillStyle = PAL.p2; b.fillRect(sx0 + x, sy0 + y, 1, 1); }
    }
    // far red hills + mesas + crater rims, dust devils drifting far away, horizon haze over the hill bases
    const fOff = Math.floor(G.bgDist * 0.1) % 1200;
    for (let x = -fOff; x < W; x += 1200) drawSprite(tiles.far, x, GROUND - 63);
    for (const dv of G.devils) for (let yy = 0; yy < dv.h; yy++) {
      const wdt = 1 + yy * 0.32, cx = dv.x + Math.sin(yy * 0.45 + dv.ph) * 1.6;
      for (let xx = Math.floor(cx - wdt); xx <= cx + wdt; xx++) { const y = GROUND - 2 - yy; if (bay(xx, y + (G.frame >> 2)) < 0.45) { b.fillStyle = PAL.hz; b.fillRect(xx, y, 1, 1); } }
    }
    b.fillStyle = PAL.hz;
    for (let y = GROUND - 7; y < GROUND; y++) for (let x = 0; x < W; x++) if (bay(x, y) < (y - (GROUND - 7)) / 7 * 0.38) b.fillRect(x, y, 1, 1);
    // ground
    const gOff = Math.floor(G.dist) % 1200;
    for (let x = -gOff; x < W; x += 1200) drawSprite(tiles.ground, x, GROUND - 2);
    b.fillStyle = PAL.R;
    for (const o of G.obstacles) if (!o.type.flying) b.fillRect(Math.round(o.x) + 2, GROUND + 1, o.w + 2, 1);
    // obstacles
    for (const o of G.obstacles) {
      if (o.type.flying) {
        const fr = Math.floor(o.anim / 6) % 4;
        drawSprite(bake('wig' + fr, OB.wig[fr]), o.x, o.y);
      } else {
        const sp = bake(o.type.id, OB[o.type.id]);
        for (let i = 0; i < o.size; i++) drawSprite(sp, o.x + i * o.type.w, o.y);
      }
    }
    // airborne shadow dash
    const air = GROUND_Y - h.y;
    if (air > 2) { const shw = Math.max(18, 60 - air * 0.45); b.fillStyle = PAL.R; b.fillRect(Math.round(HERO_X + 40 - shw / 2), GROUND + 2, Math.round(shw), 1); }
    // particles + landing dust
    for (const p of G.parts) {
      const k = p.life / p.max, s = Math.max(1, Math.round(p.size * (1 - k * 0.5)));
      b.fillStyle = PCOL[p.color] || PAL.k; b.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    drawBlobs('dust', false, ne);
    // impact: short ink rays
    if (G.boom && G.boom.f < 8) {
      b.fillStyle = PAL.k;
      const r0 = 4 + G.boom.f * 1.5, r1 = r0 + 5 - G.boom.f * 0.5;
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + 0.2; for (let r = r0; r < r1; r++) b.fillRect(Math.round(G.boom.x + Math.cos(a) * r), Math.round(G.boom.y + Math.sin(a) * r), 1, 1); }
    }
    // HUD (original style: HI 00000 00000, blink at every 100)
    if (G.mode !== 'intro') {
      const pad = n => String(Math.min(99999, n)).padStart(5, '0');
      const sx = W - HUDM - 58;
      let show = true, val = G.score;
      if (G.flash > 0) { val = G.lastMilestone; show = Math.floor(G.flash / 8) % 2 === 1; }
      if (show) text(pad(val), sx, HUDM, PAL.b);
      if (hiScore > 0) { text('HI', sx - 12 * 9, HUDM, PAL.b2); text(pad(hiScore), sx - 12 * 6.5, HUDM, PAL.b2); }
    }
    for (const pu of G.popups) if (pu.f < 44 || (pu.f >> 2) % 2) text('+50 FLIP', pu.x, pu.y - Math.round(Math.min(pu.f, 30) * 0.6), PAL.b);
    if (G.mode === 'over' && G.deadFrames >= 18) {   // GAME OVER lands ~0.3 s after the impact
      const gx = Math.round(W / 2 - (9 * 12 - 2) / 2), gy = Math.round(GROUND * 0.34);
      text('GAME OVER', gx, gy, PAL.b);
      const rx = Math.round(W / 2), ry = gy + 40;
      b.fillStyle = PAL.b;
      for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
        const d = Math.hypot(x, y), a = Math.atan2(y, x);
        if (d >= 7.5 && d <= 10.5 && !(a > -1.25 && a < -0.15)) b.fillRect(rx + x, ry + y, 1, 1);
      }
      for (let i = 0; i < 6; i++) b.fillRect(rx + 4 + i - 2, ry - 9 + i - 1, 7 - i, 1); // arrow head
    }
    nightPass(t);
    // night sky: stars and two tiny moons, faded in with the palette
    if (t > 0) {
      b.globalAlpha = t; b.fillStyle = '#f3d9c8';
      for (const s of G.stars) {
        if (s.x > W) continue;
        b.fillRect(s.x, s.y, 1, 1);
        if (s.big || (f + s.tw) % 120 < 14) { b.globalAlpha = t * 0.5; b.fillRect(s.x - 1, s.y, 3, 1); b.fillRect(s.x, s.y - 1, 1, 3); b.globalAlpha = t; }
      }
      const px = Math.round(W * 0.66), py = Math.round(GROUND * 0.2);      // Phobos: small, lumpy
      for (const [x, y] of [[0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [2, 1], [3, 1], [-1, 2], [0, 2], [1, 2], [2, 2], [0, 3], [1, 3]]) b.fillRect(px + x, py + y, 1, 1);
      b.fillStyle = '#c99a86'; b.fillRect(px + 2, py + 2, 1, 1);
      b.fillStyle = '#f3d9c8'; const qx = Math.round(W * 0.84), qy = Math.round(GROUND * 0.12); // Deimos: a dot
      b.fillRect(qx, qy, 2, 2);
      b.globalAlpha = 1;
    }

    // hero: the roadster (drawn after the palette pass, it keeps its colour)
    const phase = G.mode === 'play' ? Math.floor(G.dist / 3) % 10 : 0;
    let spr, hy, hx = HERO_X, squat = 0, ducked = false;
    if (G.mode === 'over') {
      spr = truckSprite(G.hitFlash > 0 ? { dead: true, squat: 1, white: true } : { dead: true, squat: 1, lamp: false });
      hy = Math.round(h.y) + (STAND_H - spr.h); hx = HERO_X + Math.round(G.knock); squat = 1;
    } else if (h.ducking && !h.jumping) { spr = truckSprite({ phase, squat: 6, duck: true }); hy = GROUND + 1 - DUCK_H; squat = 6; ducked = true; }
    else {
      if (G.squash > 0) squat = G.squash > 4 ? 2 : 1;
      else if (G.mode === 'play' && !h.jumping) squat = Math.floor(G.dist / 26) % 2;
      const thrust = h.jumping && (G.jumpAge <= 9 || G.retro > 0);
      const lamp = G.mode === 'intro' ? (G.introFrames % 50 < 25) : true;
      spr = truckSprite({ phase, squat, thrust, lamp });
      hy = h.y + (STAND_H - spr.h);
    }
    drawBlobs('billow', false, ne);
    drawBlobs('wisp', false, ne);
    if (G.mode === 'over' && Math.abs(G.tilt) > 0.01) {          // crash tilt around the rear wheel
      const pvx = hx + WHEELS[0], pvy = hy + spr.h - 1;
      b.save(); b.translate(pvx, pvy); b.rotate(G.tilt); b.drawImage(spr.c, Math.round(hx - pvx), Math.round(hy - pvy)); b.restore();
    } else if (h.flipT >= 0) {                                   // backflip: 8 crisp 45° steps around the car's centre
      const pvx = hx + spr.w / 2, pvy = hy + spr.h / 2;
      b.imageSmoothingEnabled = false;
      b.save(); b.translate(Math.round(pvx), Math.round(pvy)); b.rotate(flipAngle(h)); b.drawImage(spr.c, -Math.round(spr.w / 2), -Math.round(spr.h / 2)); b.restore();
    } else drawSprite(spr, hx, hy);
    // night headlight beam
    if (t > 0.5 && G.mode !== 'over') {
      const lx = HERO_X + 77, ly = hy + LAMP_ROW + squat - (TRH - spr.h) - (ducked ? 0 : 0);
      b.fillStyle = '#fff4e0';
      for (let i = 0; i < 120; i++) {
        const a = 0.16 - i / 120 * 0.15; if (a <= 0) break;
        b.globalAlpha = a * t; const half = 1 + i * 0.12;
        b.fillRect(lx + i, Math.round(ly - half * 0.6), 1, Math.round(half * 1.4));
      }
      b.globalAlpha = 1;
    }
    drawBlobs('vapor', false, ne);
    if (G.hitStop > 0) { b.globalAlpha = 0.2; b.fillStyle = '#ffffff'; b.fillRect(0, 0, W, H); b.globalAlpha = 1; } // impact flash

    // compose with screen shake (underlay the unshifted frame so no page strip shows)
    let sx = 0, sy = 0;
    if (G.shake > 0) { const amp = G.shake / 14 * 3; sx = Math.round(Math.sin(G.frame * 2.7) * amp); sy = Math.round(Math.cos(G.frame * 3.3) * amp * 0.6); }
    ctx.imageSmoothingEnabled = false;
    if (sx || sy) ctx.drawImage(buf, 0, 0, W, H, 0, 0, cv.width, cv.height);
    ctx.drawImage(buf, 0, 0, W, H, sx * scale, sy * scale, cv.width, cv.height);

    const a = G.mode === 'intro' ? 1 : Math.max(0, 1 - G.playFrames / 24);
    msg.style.opacity = a.toFixed(3);
    hint.style.visibility = (BOT && !REC) ? 'hidden' : 'visible';
  }

  // ---------- loop ----------
  newGame(true);
  layout();
  window.addEventListener('resize', layout);
  let acc = 0, last = 0;
  function frame(ts) {
    if (!last) last = ts;
    const dt = Math.min(0.1, (ts - last) / 1000); last = ts;
    acc += dt;
    while (acc >= STEP) { tick(); acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  window.__debug = () => G;
  window.__botDebug = { simulate, POLICIES, heroBoxes, obBoxes };
  window.__state = () => ({ score: G.score, speed: +G.speed.toFixed(3), alive: G.mode !== 'over', night: !!G.night, mode: G.mode, hi: hiScore });
  window.__time = () => +(REC ? stepTime : simTime).toFixed(4);
  window.__events = () => EVENTS.slice();
  window.__start = () => { if (G.mode === 'intro') { start(); if (!BOT) { G.jumpHeld = false; heroEndJump(G.hero); } } if (REC) render(); return window.__state(); };
  window.__bot = (on) => {
    BOT = on === undefined ? !BOT : !!on;
    if (!BOT && G) { G.plan = null; if (G.jumpHeld) releaseJump(); if (G.duckHeld) releaseDuck(); }
    return BOT;
  };
  if (REC) {
    let racc = 0;
    window.__step = (dt) => {
      dt = Math.max(0, +dt || 0);
      stepTime += dt; racc += dt;
      while (racc >= STEP - 1e-9) { tick(); racc -= STEP; }
      render();
      return window.__state();
    };
    render();
    window.__ready = true;
  } else {
    requestAnimationFrame(frame);
    window.__ready = true;
  }
})();
