/* HOPPER — No Signal. An original endless hopper starring a thruster-hopping pickup. */
(() => {
  'use strict';

  // ---------- params ----------
  const Q = new URLSearchParams(location.search);
  let BOT = Q.get('bot') === '1';
  const REC = Q.get('rec') === '1';
  const SCALE_PARAM = parseInt(Q.get('scale') || '0', 10) || 0;
  const SEED = Q.has('seed') ? (parseInt(Q.get('seed'), 10) >>> 0) : (REC ? 1337 : (Math.random() * 1e9) >>> 0);

  function mulberry(a) {
    return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const rng = mulberry(SEED);
  const botRng = mulberry(SEED ^ 0x9e3779b9);
  const fxRng = mulberry(SEED ^ 0x1234567);
  const rint = (a, b) => Math.floor(rng() * (b - a + 1)) + a;

  // ---------- constants (per-frame units at 60 fps) ----------
  const H = 216, GROUND = 176, HERO_X = 40, HERO_W = 58;
  const STEP = 1 / 60;
  const GRAVITY = 0.6, JUMP_V = -10, DROP_V = -5, MIN_JUMP = 30, MAX_JUMP = 63, DROP_COEF = 3;
  const SPEED0 = 6, SPEED_MAX = 11.5, ACCEL = 0.001;
  const SCORE_COEF = 0.025, CLEAR_FRAMES = 140, NIGHT_EVERY = 700, NIGHT_FRAMES = 720, GAP_COEF = 0.6, MAX_GAP_COEF = 1.5;
  const WIG_AFTER = REC ? 330 : 700; // frames of play before wigs may appear

  // ---------- palette: [day, night] ----------
  const PAL = {
    k: ['#2b2533', '#0c0f1f'], K: ['#4a4152', '#1d2340'], g: ['#8c8494', '#56608a'],
    n: ['#6d6675', '#3b4366'], N: ['#a8a1ae', '#6c76a0'], h: ['#cfc8bc', '#9aa3c4'], H: ['#fbf6ea', '#dfe6ff'],
    t: ['#2b2533', '#0c0f1f'], T: ['#463d4f', '#1f2546'],
    a: ['#1fc4dc', '#17a6c2'], A: ['#73eefc', '#5ad6ec'], d: ['#118aa6', '#0d7290'], D: ['#0b5876', '#084660'], r: ['#e2fdff', '#c8f6ff'],
    w: ['#33405a', '#151e38'], v: ['#4d6182', '#26365a'], W: ['#f2fbff', '#e8f6ff'],
    l: ['#ffe066', '#fff4b0'], R: ['#ff3d5a', '#ff4d68'], f: ['#ffb347', '#ffd27a'],
    c: ['#ff7a2e', '#e66a2a'], C: ['#ffa463', '#ff9a5a'], e: ['#c9501a', '#a84418'], s: ['#efeae0', '#ffffff'], S: ['#ffffff', '#ffffff'],
    q: ['#bdb4a6', '#5d6688'], Q: ['#dcd4c6', '#7c86aa'], p: ['#958c7f', '#454e72'], z: ['#ffc933', '#f0b92a'],
    y: ['#e9b43a', '#e0a832'], Y: ['#ffd96b', '#ffd25e'], L: ['#fff4c4', '#fff3b8'], o: ['#b47f22', '#a8761e'], O: ['#6e4a14', '#4e3410'],
    u: ['#d8b388', '#28335f'], U: ['#e6c8a0', '#334070'],
    m: ['#e8c99c', '#1c2750'], M: ['#f5e2bf', '#2a3768'], j: ['#d8b283', '#141d42'],
    b: ['#d4ab7c', '#2b3764'], B: ['#e0bb8e', '#36437a'],
  };
  const BGC = {
    sky: [['#f8eedc', '#f6e4c6', '#f3d8ae', '#efc995'], ['#0a1130', '#101a40', '#17234f', '#212f5e']],
    sun: ['#fff6df', '#000000'], halo: ['#fbe6c0', '#000000'],
    gL: ['#e6c592', '#3d4876'], g: ['#d3a975', '#2c3560'], gD: ['#bb8f5c', '#232b50'], gDD: ['#a87d4e', '#1b2242'],
    dust: ['#ead3a9', '#5a6592'], puff: ['#fffaf0', '#d2dcff'], hud: ['#2b2533', '#e8ecff'], hudHi: ['#a08f7c', '#7f8bb8'],
    star: ['#ffffff', '#fff8dc'], beam: ['#fff2b0', '#fff2b0'], streak: ['#fffaf0', '#9fb0ff'],
  };
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`; };
  let nightMix = 0;
  const col = key => { const c = BGC[key] || PAL[key]; return mix(c[0], c[1], nightMix); };

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
    const out = { w, h, c: [] };
    for (let v = 0; v < 2; v++) {
      const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
      const x2 = cv.getContext('2d');
      for (let y = 0; y < h; y++) {
        let x = 0;
        while (x < w) {
          const ch = g[y][x];
          if (!ch) { x++; continue; }
          let e = x; while (e < w && g[y][e] === ch) e++;
          x2.fillStyle = PAL[ch] ? PAL[ch][v] : ch; x2.fillRect(x, y, e - x, 1); x = e;
        }
      }
      out.c.push(cv);
    }
    CACHE.set(key, out);
    return out;
  }

  // ---------- hero: original off-road pickup ----------
  function shade(y, top, bot) {
    const r = (y - top) / Math.max(1, bot - top);
    if (y === top) return 'r';
    return r < 0.32 ? 'A' : r < 0.68 ? 'a' : r < 0.9 ? 'd' : 'D';
  }
  function buildTruck({ phase = 0, drop = 0, cabDrop = 0, thrust = false, blink = false, dead = false }) {
    const Wd = 58, Hh = 35, g = grid(Wd, Hh);
    const wheels = [13, 44], wcy = 26;
    const lowTop = 13 + drop, lowBot = Math.min(25 + drop, 31);
    // lower body + bed
    for (let y = 9 + drop; y <= lowBot; y++) for (let x = 1; x <= 56; x++) {
      if (y < lowTop && x > 25) continue;                    // bed walls only behind the cab
      if (y < lowTop && x < 1) continue;
      const top = x <= 25 ? 9 + drop : lowTop;
      if ((x === 1 && (y === top || y === lowBot)) || (x === 56 && (y === top || y >= lowBot - 1)) || (x === 55 && y === lowBot)) continue;
      g[y][x] = shade(y, top, lowBot);
    }
    // bed inner lip (dark) to read as an open bed
    for (let x = 3; x <= 24; x++) g[10 + drop][x] = 'D';
    // cab: rounded box, front corner rounder
    const cTop = 2 + drop + cabDrop, cBot = lowTop, cL = 26, cR = 52;
    for (let y = cTop; y <= cBot; y++) for (let x = cL; x <= cR; x++) {
      const rl = 4, rr = 7;
      if (x < cL + rl && y < cTop + rl && Math.hypot(x - (cL + rl), y - (cTop + rl)) > rl + 0.3) continue;
      if (x > cR - rr && y < cTop + rr && Math.hypot(x - (cR - rr), y - (cTop + rr)) > rr + 0.3) continue;
      g[y][x] = shade(y, cTop, cBot + 10);
    }
    // wheel arches
    for (const cx of wheels) for (let y = 0; y < Hh; y++) for (let x = 0; x < Wd; x++) if (Math.hypot(x - cx, y - wcy) < 10.6 && y > lowTop - 2) g[y][x] = null;
    outline(g, 'k');
    // windows
    const gT = cTop + 3, gB = cBot - 2;
    for (let y = gT; y <= gB; y++) for (let x = cL + 3; x <= cR - 3; x++) {
      const rr = 5;
      if (x > cR - 3 - rr && y < gT + rr && Math.hypot(x - (cR - 3 - rr), y - (gT + rr)) > rr) continue;
      if (x === 38 || x === 39) continue; // B-pillar
      g[y][x] = y === gT ? 'v' : 'w';
      if (!dead && ((x - y * 1.2 + 200) % 11 < 1.6 || (x - y * 1.2 + 200) % 11 < 2.6 && (x - y * 1.2 + 200) % 11 > 1.6 && y < gT + 3)) g[y][x] = 'W';
    }
    if (dead) { const cr = [[31, gT + 1], [32, gT + 2], [33, gT + 2], [34, gT + 3], [33, gT + 4], [42, gT + 1], [43, gT + 2], [44, gT + 3], [45, gT + 3], [44, gT + 4]]; for (const [x, y] of cr) if (y <= gB) g[y][x] = 'W'; }
    // light bar
    for (let x = 31; x <= 45; x++) g[cTop - 1][x] = 'K';
    for (let x = 32; x <= 44; x++) g[cTop - 2][x] = (dead || blink) ? 'K' : (x % 3 === 2 ? 'k' : 'l');
    g[cTop - 2][31] = 'k'; g[cTop - 2][45] = 'k';
    // door seam, handle, rim-light on edges
    for (let y = lowTop + 1; y <= lowBot - 2; y++) if (g[y][38] && g[y][38] !== 'k') g[y][38] = 'D';
    for (let y = lowTop + 1; y <= lowBot - 2; y++) if (g[y][26] && g[y][26] !== 'k') g[y][26] = 'D';
    g[lowTop + 3][41] = 'K'; g[lowTop + 3][42] = 'K'; g[lowTop + 3][43] = 'K';
    // stripe decal
    for (let x = 4; x <= 53; x++) { const y = lowTop + 6; if (g[y] && g[y][x] && g[y][x] !== 'k' && g[y][x] !== 'D') g[y][x] = 'r'; }
    // lamps
    g[lowTop + 2][55] = 'l'; g[lowTop + 2][56] = 'l'; g[lowTop + 3][55] = 'l'; g[lowTop + 3][56] = 'k';
    g[11 + drop][1] = 'R'; g[12 + drop][1] = 'R';
    // bumpers
    for (let x = 51; x <= 57; x++) { g[lowBot][x] = x === 57 ? 'k' : 'N'; g[lowBot + 1] && (g[lowBot + 1][x] = 'n'); }
    for (let x = 0; x <= 5; x++) { g[lowBot][x] = 'N'; g[lowBot + 1] && (g[lowBot + 1][x] = 'n'); }
    // chassis + air thrusters
    const cy0 = Math.min(lowBot + 1, 31);
    for (let x = 23; x <= 34; x++) g[cy0][x] = 'K';
    for (const nx of [24, 31]) {
      for (let dy = 1; dy <= 2; dy++) for (let dx = 0; dx < 3; dx++) if (cy0 + dy < Hh) g[cy0 + dy][nx + dx] = dx === 1 ? 'N' : 'n';
      if (cy0 + 3 < Hh) for (let dx = 0; dx < 3; dx++) g[cy0 + 3][nx + dx] = thrust ? (dx === 1 ? 'L' : 'f') : (dx === 1 ? 'k' : null);
    }
    // wheels: chunky lugs + rotating hub
    for (const cx of wheels) for (let y = wcy - 9; y <= wcy + 9; y++) for (let x = cx - 9; x <= cx + 9; x++) {
      if (y < 0 || y >= Hh) continue;
      const dx = x - cx, dy = y - wcy, rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      const lug = Math.floor(((ang / (Math.PI * 2)) * 12 + phase / 4 + 12)) % 2 === 0;
      let ch = null;
      if (rr <= 8.9 && rr > 7.6) ch = lug ? 't' : (rr < 8.3 ? 'T' : null);
      else if (rr <= 7.6 && rr > 5.2) ch = (dx + dy < -4 && rr > 6.2) ? 'g' : 'K';
      else if (rr <= 5.2 && rr > 4.1) ch = 'n';
      else if (rr <= 4.1) {
        ch = 'h';
        if (dx + dy < -2) ch = 'H';
        for (let i = 0; i < 4; i++) { const a = phase * Math.PI / 8 + i * Math.PI / 2; if (Math.abs(x - (cx + Math.cos(a) * 2.6)) < 0.75 && Math.abs(y - (wcy + Math.sin(a) * 2.6)) < 0.75) ch = 'k'; }
        if (rr < 1.1) ch = 'k';
      }
      if (ch) g[y][x] = ch;
    }
    return g;
  }
  const truckSprite = o => bake('truck' + JSON.stringify(o), cropTop(buildTruck(o)));
  const STAND_G = buildTruck({}), STAND_C = cropTop(STAND_G);
  const DUCK_G = cropTop(buildTruck({ drop: 7, cabDrop: 3 }));
  const STAND_H = STAND_C.length, DUCK_H = DUCK_G.length;
  const HERO_BOX = autoBoxes(STAND_C, 5, 2), DUCK_BOX = autoBoxes(DUCK_G, 5, 2);

  // ---------- obstacles ----------
  function coneGrid(h = 26, rims = []) {
    const w = 18, g = grid(w, h), base = h - 3;
    for (let y = 0; y < base; y++) {
      let hw = 1.2 + (y / (base - 1)) * 6.6;
      if (rims.some(r => y >= r && y < r + 2)) hw += 1.6;
      for (let x = 0; x < w; x++) {
        const d = x - 8.5;
        if (Math.abs(d) > hw) continue;
        const rel = (d + hw) / (2 * hw);
        g[y][x] = rel < 0.3 ? 'C' : rel < 0.72 ? 'c' : 'e';
        if (rims.some(r => y === r + 2)) g[y][x] = 'e';
      }
    }
    for (let y = base; y < h; y++) for (let x = 0; x < w; x++) g[y][x] = y === base ? 'K' : 'k';
    outline(g, 'k');
    const stripes = h > 30 ? [Math.round(base * 0.28), Math.round(base * 0.62)] : [Math.round(base * 0.36), Math.round(base * 0.66)];
    for (const sy of stripes) for (let y = sy; y < sy + 3; y++) for (let x = 0; x < w; x++) if (g[y][x] && g[y][x] !== 'k') {
      const d = x - 8.5; g[y][x] = d < -1 ? 'S' : 's'; if (y === sy + 2 && d > 1) g[y][x] = 'q';
    }
    return g;
  }
  function barrierGrid() {
    const w = 30, h = 22, g = grid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const inset = y < 13 ? 2 : Math.max(0, 2 - (y - 13));
      if (x < inset || x >= w - inset) continue;
      if ((y === 0 && (x <= inset || x >= w - inset - 1))) continue;
      if (y >= 18 && ((x >= 6 && x <= 9) || (x >= 20 && x <= 23))) continue; // forklift slots
      g[y][x] = y < 2 ? 'Q' : y < 13 ? 'q' : 'p';
      if (y >= 3 && y <= 9) g[y][x] = ((x + y) % 8 < 4) ? 'c' : 's';
    }
    outline(g, 'k');
    for (const rx of [5, 24]) { g[14][rx] = 'l'; g[14][rx + 1] = 'l'; g[15][rx] = 'z'; g[15][rx + 1] = 'z'; }
    return g;
  }
  function padGrid() {
    const w = 24, h = 32, g = grid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if ((x === 0 || x === w - 1) && (y === 0)) continue;
      g[y][x] = x < 3 ? 'N' : x > w - 4 ? 'n' : 'g';
      if (y >= 3 && y <= 10) g[y][x] = ((x + y) % 7 < 3) ? 'k' : 'z';
      if (y === 11 || y === 2) g[y][x] = 'K';
    }
    outline(g, 'k');
    for (const [x, y] of [[3, 14], [w - 4, 14], [3, h - 4], [w - 4, h - 4]]) { g[y][x] = 'H'; g[y + 1][x] = 'n'; }
    for (let y = 14; y < h - 2; y++) g[y][12] = 'n';
    return g;
  }
  const WIG_BODY = [
    '.....OOOOOO..........................',
    '...OOYYLLYYOO........................',
    '..OYYLLYYYYYYOO......................',
    '.OYLYYYyyyYYYYYOOOOO.................',
    '.OYYyyoyyyyyYYLLYYYYOOOOOO...........',
    'OYYyyyoyyyyyyyyyYYYYLLYYYYOOOOO......',
    'OYyyyyyoyyyyyyoyyyyyyYYYYYYYYYYOOO...',
    'OYyyyyyyoyyyoyyyyyoyyyyyyyyyyyyYYYO..',
    'OyyyyoyyyyyyoyyyyyoyyyyyoyyyyyyyyyyO.',
    '.OyyyyoyyyyoyyyyyoyyyyyoyyyyyoyyyyO..',
    '.OoyyyyyyyoyyyyyoyyyyyoyyyyyoyyyoO...',
    '..OooyyyoyyyyyoyyyyyoyyyyyoyyyooO....',
    '...OOooooooooooooooooooooooooooO.....',
    '.....OoOOoOOoOOoOOoOOoOOoOOoOOO......',
    '......O..O..O..O..O..O..O..O.........',
  ];
  function wigGrid(frame, coreOnly) {
    const w = 48, h = 24, g = grid(w, h), ox = 6, oy = 5;
    WIG_BODY.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') g[oy + y][ox + x] = row[x]; });
    if (!coreOnly) {
      const ang = [-0.95, -0.3, 0.45, -0.3][frame];               // flap: up, mid, down, mid
      const cells = [];
      const wing = (rx, ry, dir) => {
        for (const spread of [-0.3, 0, 0.3]) {
          const a = ang + spread, len = 13 - Math.abs(spread) * 9;
          for (let i = 0; i <= 30; i++) {
            const t = i / 30, x = rx + dir * Math.cos(a) * len * t, y = ry + Math.sin(a) * len * t + Math.sin(t * Math.PI) * 1.2;
            const r = 1.5 * (1 - t) + 0.5;
            for (let yy = Math.floor(y - r); yy <= Math.ceil(y + r); yy++) for (let xx = Math.floor(x - r); xx <= Math.ceil(x + r); xx++) {
              if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
              if (Math.hypot(xx - x, yy - y) <= r && !g[yy][xx]) { g[yy][xx] = yy <= y - 0.5 ? 'Y' : 'y'; cells.push([xx, yy]); }
            }
          }
        }
      };
      wing(ox + 3, oy + 10, -1);
      wing(ox + 33, oy + 8, 1);
      for (const [x, y] of cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && !g[yy][xx]) g[yy][xx] = 'O';
      }
    }
    return g;
  }
  const OB = {
    cone: coneGrid(26), stack: coneGrid(38, [12, 23]), barrier: barrierGrid(), pad: padGrid(),
    wig: [0, 1, 2, 3].map(f => wigGrid(f)),
  };
  const BOX = {
    cone: autoBoxes(OB.cone, 4, 1), stack: autoBoxes(OB.stack, 5, 1), barrier: autoBoxes(OB.barrier, 6, 1), pad: autoBoxes(OB.pad, 8, 1),
    wig: autoBoxes(wigGrid(0, true), 4, 2),
  };
  const TYPES = [
    { id: 'cone', w: 18, h: 26, minSpeed: 0, multiSpeed: 6.6, maxSize: 3, minGap: 120 },
    { id: 'stack', w: 18, h: 38, minSpeed: 0, multiSpeed: 8, maxSize: 2, minGap: 120 },
    { id: 'barrier', w: 30, h: 22, minSpeed: 6.4, multiSpeed: 99, maxSize: 1, minGap: 130 },
    { id: 'pad', w: 24, h: 32, minSpeed: 0, multiSpeed: 9, maxSize: 2, minGap: 120 },
    { id: 'wig', w: 48, h: 24, minSpeed: 0, multiSpeed: 999, maxSize: 1, minGap: 150, flying: true },
  ];
  const WIG_Y = [GROUND - 26, GROUND - 47, GROUND - 86]; // low (hop), mid (duck), high (pass)

  // background sprites
  function towerGrid(hgt) {
    const w = 22, g = grid(w, hgt + 6);
    const top = 6;
    for (let y = top; y < hgt + 6; y++) { g[y][2] = 'u'; g[y][10] = 'u'; }
    for (let y = top; y < hgt + 2; y += 8) for (let i = 0; i <= 8; i++) { if (y + i < hgt + 6) { g[y + i][2 + i] = 'u'; g[y + i][10 - i] = 'u'; } g[y][2 + i] = 'u'; }
    for (let x = 0; x <= 12; x++) { g[top][x] = 'U'; g[top + 1][x] = 'u'; }
    for (let y = 2; y < top; y++) g[y][6] = 'u';
    for (let x = 11; x <= 15; x++) g[top + 10][x] = 'u';
    // rocket
    for (let y = top + 6; y < hgt + 6; y++) for (let x = 15; x <= 19; x++) g[y][x] = x === 15 ? 'U' : 'u';
    g[top + 4][17] = 'u'; for (let x = 16; x <= 18; x++) g[top + 5][x] = 'u';
    for (let x = 13; x <= 21; x++) for (let y = hgt + 2; y < hgt + 6; y++) g[y][x] = 'u';
    return g;
  }
  function rockGrid(w, h) {
    const g = grid(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const nx = (x - w / 2) / (w / 2), ny = (h - y) / h;
      if (nx * nx + ny * ny * 1.1 <= 1.0 + 0.08 * Math.sin(x * 1.7)) g[y][x] = (x < w * 0.45 && y < h * 0.6) ? 'B' : 'b';
    }
    return g;
  }
  function cactusGrid(h) {
    const w = 15, g = grid(w, h);
    const fill = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (y >= 0 && y < h) g[y][x] = x === x0 ? 'B' : 'b'; };
    fill(6, 1, 8, h - 1); g[0][7] = 'b';
    fill(1, Math.round(h * 0.25), 3, Math.round(h * 0.55)); fill(1, Math.round(h * 0.55), 6, Math.round(h * 0.55) + 1);
    fill(11, Math.round(h * 0.15), 13, Math.round(h * 0.45)); fill(8, Math.round(h * 0.45), 13, Math.round(h * 0.45) + 1);
    return g;
  }
  const BG = {
    towers: [bake('tw1', towerGrid(58)), bake('tw2', towerGrid(74)), bake('tw3', towerGrid(48))],
    rocks: [bake('r1', rockGrid(22, 9)), bake('r2', rockGrid(14, 6)), bake('r3', rockGrid(30, 12)), bake('c1', cactusGrid(24)), bake('c2', cactusGrid(18))],
  };

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
  };

  // ---------- canvas & layout ----------
  const cv = document.getElementById('c');
  const ctx = cv.getContext('2d');
  const buf = document.createElement('canvas');
  const b = buf.getContext('2d');
  const msg = document.getElementById('msg');
  const hint = document.getElementById('hint');
  let W = 480, scale = 3;
  const skyCache = { w: 0, c: null };

  function layout() {
    const dpr = window.devicePixelRatio || 1;
    const availW = window.innerWidth * dpr, availH = window.innerHeight * dpr;
    let s = SCALE_PARAM || Math.floor(Math.min(availH * 0.62 / H, availW / 400));
    if (s < 1) s = Math.min(availW / 400, availH * 0.62 / H);
    W = Math.max(320, Math.min(1100, Math.floor(availW / s)));
    scale = s;
    buf.width = W; buf.height = H;
    cv.width = Math.round(W * s); cv.height = Math.round(H * s);
    cv.style.width = (cv.width / dpr) + 'px';
    cv.style.height = (cv.height / dpr) + 'px';
    ctx.imageSmoothingEnabled = false;
    skyCache.w = 0;
    if (G) render(); // keep the frame visible after a resize (matters in ?rec=1, where nothing else redraws)
  }

  // ---------- sky / far layers (baked for day and night, crossfaded) ----------
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function bakeSky() {
    const hgt = GROUND + 2;
    skyCache.c = [0, 1].map(v => {
      const c = document.createElement('canvas'); c.width = W; c.height = hgt;
      const x2 = c.getContext('2d');
      const stops = BGC.sky[v], seg = hgt / (stops.length - 1);
      for (let y = 0; y < hgt; y++) {
        // flat bands with a short ordered-dither seam between them (classic pixel-art sky)
        const f = y / seg, i = Math.min(stops.length - 2, Math.floor(f)), t = f - i;
        const tt = Math.max(0, Math.min(1, (t - 0.72) / 0.28));
        if (tt <= 0) { x2.fillStyle = stops[i]; x2.fillRect(0, y, W, 1); continue; }
        for (let x = 0; x < W; x += 1) {
          const th = (BAYER[y & 3][x & 3] + 0.5) / 16;
          x2.fillStyle = tt > th ? stops[i + 1] : stops[i];
          x2.fillRect(x, y, 1, 1);
        }
      }
      if (v === 0) { // sun with dithered halo
        const sx = Math.round(W * 0.74), sy = 54;
        for (let y = sy - 30; y <= sy + 30; y++) for (let x = sx - 30; x <= sx + 30; x++) {
          const d = Math.hypot(x - sx, y - sy);
          if (d <= 17) { x2.fillStyle = BGC.sun[0]; x2.fillRect(x, y, 1, 1); }
          else if (d <= 26 && (BAYER[y & 3][x & 3] / 16) < (26 - d) / 12) { x2.fillStyle = BGC.halo[0]; x2.fillRect(x, y, 1, 1); }
        }
      }
      return c;
    });
    // far mesas tile (periodic)
    const r = mulberry(SEED ^ 0xabc);
    const TW = 720, heights = new Array(TW).fill(0);
    let x = 0;
    while (x < TW) {
      const len = 40 + Math.floor(r() * 110), hh = 16 + Math.floor(r() * 34), slope = 1 + Math.floor(r() * 3);
      for (let i = 0; i < len && x + i < TW; i++) {
        const edge = Math.min(i, len - 1 - i);
        heights[x + i] = Math.max(heights[x + i], Math.min(hh, edge * slope + 3));
      }
      x += len - Math.floor(r() * 30) + Math.floor(r() * 40);
    }
    for (let i = 0; i < 30; i++) { const t = i / 30; heights[TW - 30 + i] = Math.round(heights[TW - 30 + i] * (1 - t) + heights[i] * t); }
    skyCache.mesa = [0, 1].map(v => {
      const c = document.createElement('canvas'); c.width = TW; c.height = 60;
      const x2 = c.getContext('2d');
      for (let xx = 0; xx < TW; xx++) {
        const hh = heights[xx]; if (!hh) continue;
        for (let yy = 60 - hh; yy < 60; yy++) {
          const dtop = yy - (60 - hh);
          let ch = dtop < 2 ? 'M' : 'm';
          // right-facing slopes in shadow, left-facing slopes lit
          const slope = heights[(xx + 3) % TW] - heights[(xx - 3 + TW) % TW];
          if (slope < -1 && dtop > 0) ch = 'j';
          else if (slope > 1 && dtop > 0) ch = 'M';
          if (yy % 11 === 6 && dtop > 3 && BAYER[yy & 3][xx & 3] < 6) ch = 'j';
          x2.fillStyle = PAL[ch][v]; x2.fillRect(xx, yy, 1, 1);
        }
      }
      return c;
    });
    skyCache.mesaW = TW;
    // ground tile
    const GW = 256, GH = H - GROUND;
    const gr = mulberry(SEED ^ 0x51ed);
    const specks = [];
    for (let i = 0; i < 70; i++) specks.push([Math.floor(gr() * GW), 3 + Math.floor(gr() * (GH - 4)), 1 + Math.floor(gr() * 3), gr()]);
    skyCache.ground = [0, 1].map(v => {
      const c = document.createElement('canvas'); c.width = GW; c.height = GH;
      const x2 = c.getContext('2d');
      for (let y = 0; y < GH; y++) for (let xx = 0; xx < GW; xx++) {
        let k = 'g';
        if (y === 0) k = 'gL';
        else if (y === 1) k = BAYER[y & 3][xx & 3] < 8 ? 'gL' : 'g';
        else if (y >= GH - 6) k = 'gDD';
        else if (y >= GH - 10) k = (BAYER[y & 3][xx & 3] / 16) < (y - (GH - 10)) / 4 ? 'gDD' : 'gD';
        else if (y > GH * 0.5) k = (BAYER[y & 3][xx & 3] / 16) < (y - GH * 0.5) / (GH * 0.5 - 10) ? 'gD' : 'g';
        x2.fillStyle = BGC[k][v]; x2.fillRect(xx, y, 1, 1);
      }
      for (const [sx, sy, sw, t] of specks) {
        x2.fillStyle = BGC[t < 0.5 ? 'gD' : 'gDD'][v]; x2.fillRect(sx, sy, sw, 1);
        if (t > 0.8) { x2.fillStyle = BGC.gL[v]; x2.fillRect(sx, sy - 1, sw, 1); }
      }
      return c;
    });
    skyCache.w = W;
  }
  function drawBaked(arr, x, y) {
    b.drawImage(arr[0], x, y);
    if (nightMix > 0) { b.globalAlpha = nightMix; b.drawImage(arr[1], x, y); b.globalAlpha = 1; }
  }
  function drawSprite(sp, x, y) { drawBaked(sp.c, Math.round(x), Math.round(y)); }

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
  const newHero = () => ({ y: GROUND_Y, vy: 0, jumping: false, reachedMin: false, released: false, speedDrop: false, ducking: false });
  function heroJump(h, speed) {
    if (h.jumping || h.ducking) return false;
    h.jumping = true; h.reachedMin = false; h.released = false; h.speedDrop = false; h.vy = JUMP_V - speed / 10; return true;
  }
  function heroEndJump(h) { h.released = true; if (h.reachedMin && h.vy < DROP_V) h.vy = DROP_V; }
  function heroDuck(h, on) {
    if (on) { if (h.jumping) { if (!h.speedDrop) { h.speedDrop = true; h.vy = 1; } } else h.ducking = true; }
    else { h.ducking = false; h.speedDrop = false; }
  }
  function heroStep(h) {
    if (!h.jumping) return false;
    h.y += Math.round(h.speedDrop ? h.vy * DROP_COEF : h.vy);
    h.vy += GRAVITY;
    if (h.y < GROUND_Y - MIN_JUMP || h.speedDrop) h.reachedMin = true;
    if (h.y < GROUND_Y - MAX_JUMP || h.speedDrop || h.released) heroEndJump(h);
    if (h.y > GROUND_Y) { h.y = GROUND_Y; h.jumping = false; h.vy = 0; h.reachedMin = false; const sd = h.speedDrop; h.speedDrop = false; if (sd) h.ducking = true; return true; }
    return false;
  }
  function heroBoxes(h) {
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
      obstacles: [], lastTypes: [], parts: [], streaks: [],
      night: false, nightFrames: 0, nextNight: NIGHT_EVERY, stars: [],
      flash: 0, jumpHeld: false, duckHeld: false, plan: null, squash: 0, shake: 0, boom: null,
    };
    makeStars();
  }
  function makeStars() {
    const r = mulberry(SEED ^ (G.nextNight * 7));
    G.stars = [];
    for (let i = 0; i < 40; i++) G.stars.push({ x: Math.floor(r() * 1100), y: 4 + Math.floor(r() * (GROUND - 70)), tw: Math.floor(r() * 120), big: r() < 0.18 });
  }
  function start() { if (G.mode !== 'intro') return; G.mode = 'play'; G.playFrames = 0; doJump(); }
  function restart() { newGame(false); }
  function doJump() {
    if (heroJump(G.hero, G.speed)) {
      SFX.jump(); ev('jump');
      for (let i = 0; i < 8; i++) {
        const nx = HERO_X + (i % 2 ? 25 : 32) + 1;
        part(nx + fxRng() * 2, GROUND - 2, -1.6 + fxRng() * 3.2 - G.speed * 0.15, -0.2 - fxRng() * 0.9, 16 + fxRng() * 10, 'puff', 3);
      }
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
    const y = type.flying ? WIG_Y[G.firstWig === true ? (G.firstWig = 'done', 1) : rint(0, 2)] : GROUND + 1 - h;
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
      if (pol && pol.kind === 'duck' && f === duckUntil) heroDuck(h, false);
      const landed = heroStep(h);
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
    else { const jumps = options.filter(p => p.kind === 'jump' && !p.drop); pick = jumps.length ? jumps[Math.min(jumps.length - 1, botRng() < 0.7 ? 0 : 1)] : options[0]; }
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
    nightMix += Math.sign(nt - nightMix) * Math.min(Math.abs(nt - nightMix), 1 / 40);
    if (G.shake > 0) G.shake--;
    if (G.mode === 'intro') {
      G.introFrames++;
      if (BOT && G.introFrames >= 60) start();
      updateParts(0);
      return;
    }
    if (G.mode === 'over') {
      G.deadFrames++;
      updateParts(0);
      if (G.deadFrames % 6 === 0 && G.deadFrames < 90) part(HERO_X + 36 + fxRng() * 6, G.hero.y + 6, -0.2, -0.5 - fxRng() * 0.3, 40, 'smoke', 4);
      if (BOT && G.deadFrames > 110) restart();
      return;
    }
    G.playFrames++;
    if (BOT) botThink();
    const h = G.hero;
    if (h.jumping && h.vy < -2 && G.playFrames % 2 === 0) for (const nx of [25, 32]) part(HERO_X + nx + 1, h.y + STAND_H - 1, -G.speed * 0.25, 1.2 + fxRng() * 0.6, 12, 'puff', 2);
    const landed = heroStep(h);
    if (landed) {
      if (!G.duckHeld) h.ducking = false;
      G.squash = 7;
      for (let i = 0; i < 7; i++) part(HERO_X + 4 + fxRng() * 50, GROUND - 1, (fxRng() - 0.5) * 2.4 - 1, -0.4 - fxRng() * 0.8, 18 + fxRng() * 8, 'dust', 3);
    }
    if (G.squash > 0) G.squash--;
    if (!h.jumping && G.playFrames % 3 === 0) {
      part(HERO_X + 4, GROUND - 2, -G.speed * 0.35 - fxRng(), -0.25 - fxRng() * 0.5, 16 + fxRng() * 8, 'dust', 2 + (fxRng() < 0.4 ? 1 : 0));
      if (G.playFrames % 6 === 0) part(HERO_X + 36, GROUND - 2, -G.speed * 0.3 - fxRng(), -0.2 - fxRng() * 0.4, 12, 'dust', 2);
    }

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

    const sc = Math.floor(G.dist * SCORE_COEF);
    if (sc !== G.score) {
      G.score = sc;
      if (sc > 0 && sc % 100 === 0 && sc !== G.lastMilestone) { G.lastMilestone = sc; G.flash = 60; SFX.point(); ev('point100'); }
      if (sc >= G.nextNight) { G.nextNight += NIGHT_EVERY; G.night = true; G.nightFrames = NIGHT_FRAMES; makeStars(); }
    }
    if (G.flash > 0) G.flash--;
    if (G.night) { G.nightFrames--; if (G.nightFrames <= 0) G.night = false; }

    // speed streaks
    if (sp > 8.2 && fxRng() < (sp - 8) * 0.12) G.streaks.push({ x: W + 10, y: 36 + Math.floor(fxRng() * (GROUND - 80)), len: 14 + Math.floor(fxRng() * 36), v: sp * (2 + fxRng()) });
    for (const s of G.streaks) s.x -= s.v;
    G.streaks = G.streaks.filter(s => s.x + s.len > 0);
    updateParts(sp);
  }
  function updateParts(sp) {
    for (const p of G.parts) { p.x += p.vx - sp * 0.1; p.y += p.vy; p.vy = p.vy * 0.9 + p.grav; p.vx *= 0.96; p.life++; if (p.grav && p.y > GROUND - 1) { p.y = GROUND - 1; p.vy *= -0.35; p.vx *= 0.7; } }
    G.parts = G.parts.filter(p => p.life < p.max);
  }
  function gameOver(o) {
    G.mode = 'over'; G.deadFrames = 0; G.plan = null; G.hero.ducking = false;
    SFX.crash(); ev('crash');
    G.shake = 16;
    const cx = Math.max(HERO_X + HERO_W - 6, o.x + 4), cy = Math.min(G.hero.y + 16, GROUND - 10);
    G.boom = { x: cx, y: cy, f: 0 };
    const cols = ['fire', 'fire2', 'spark', 'ink', 'acc'];
    for (let i = 0; i < 34; i++) {
      const a = fxRng() * Math.PI * 2, v = 1 + fxRng() * 3.6;
      part(cx, cy, Math.cos(a) * v, Math.sin(a) * v - 1.4, 30 + fxRng() * 30, cols[i % cols.length], 1 + (fxRng() < 0.5 ? 1 : 0), 0.14);
    }
    for (let i = 0; i < 8; i++) part(cx + (fxRng() - 0.5) * 14, cy + (fxRng() - 0.5) * 10, (fxRng() - 0.5) * 0.8, -0.3 - fxRng() * 0.5, 50, 'smoke', 5);
    if (G.score > hiScore) { hiScore = G.score; try { localStorage.setItem('hopper.hi', String(hiScore)); } catch (e) { /* storage unavailable */ } }
  }

  // ---------- render ----------
  const PCOL = { puff: 'puff', dust: 'dust', fire: 'l', fire2: 'f', spark: 'S', ink: 'k', acc: 'a', smoke: 'g' };
  function text(str, x, y, color, sc = 2) {
    b.fillStyle = color;
    for (const ch of str) {
      const gl = FONT[ch];
      if (gl) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r][c] === '#') b.fillRect(x + c * sc, y + r * sc, sc, sc);
      x += 6 * sc;
    }
  }
  function render() {
    if (skyCache.w !== W) bakeSky();
    const pageBg = mix(BGC.sky[0][0], BGC.sky[1][0], nightMix);
    document.body.style.background = pageBg;
    document.documentElement.style.setProperty('--fg', mix('#2b2533', '#e8ecff', nightMix));
    document.documentElement.style.setProperty('--muted', mix('#7a6a5a', '#9aa6d0', nightMix));

    const f = G.frame;
    // sky
    drawBaked(skyCache.c, 0, 0);
    // stars + moon
    if (nightMix > 0.02) {
      b.globalAlpha = nightMix;
      b.fillStyle = col('star');
      for (const s of G.stars) {
        if (s.x > W) continue;
        const tw = (f + s.tw) % 120 < 14;
        b.fillRect(s.x, s.y, 1, 1);
        if (s.big || tw) { b.globalAlpha = nightMix * 0.55; b.fillRect(s.x - 1, s.y, 3, 1); b.fillRect(s.x, s.y - 1, 1, 3); b.globalAlpha = nightMix; }
      }
      const mx = Math.round(W * 0.74), my = 46;
      for (let y = -12; y <= 12; y++) for (let x = -12; x <= 12; x++) {
        const d = Math.hypot(x, y), d2 = Math.hypot(x + 6, y - 3);
        if (d <= 11 && d2 > 10) { b.fillStyle = d > 9.6 ? '#cfd6ff' : '#fff8e2'; b.fillRect(mx + x, my + y, 1, 1); }
      }
      b.globalAlpha = 1;
    }
    // far mesas (parallax 0.06)
    const mW = skyCache.mesaW, mo = Math.floor(G.bgDist * 0.06) % mW;
    for (let x = -mo; x < W; x += mW) drawBaked(skyCache.mesa, x, GROUND - 58);
    // launch towers (parallax 0.16) with blinking beacons
    const TP = 900, tOff = (G.bgDist * 0.16) % TP;
    const towerPos = [[120, 0], [520, 1], [700, 2]];
    for (const [tx, ti] of towerPos) {
      for (let rep = -1; rep <= Math.ceil(W / TP); rep++) {
        const x = Math.round(tx - tOff + rep * TP);
        const sp = BG.towers[ti];
        if (x > W || x + sp.w < 0) continue;
        drawSprite(sp, x, GROUND - sp.h + 2);
        if ((f + ti * 23) % 70 < 26) {
          b.fillStyle = col('R'); b.fillRect(x + 6, GROUND - sp.h + 2, 1, 2);
          if (nightMix > 0.1) { b.globalAlpha = 0.35 * nightMix; b.fillRect(x + 4, GROUND - sp.h + 1, 5, 4); b.globalAlpha = 1; }
        }
      }
    }
    // mid rocks & cacti (parallax 0.42)
    const RP = 640, rOff = (G.bgDist * 0.42) % RP;
    const rockPos = [[30, 0], [150, 3], [260, 1], [380, 4], [470, 2], [560, 3]];
    for (const [rx, ri] of rockPos) for (let rep = -1; rep <= Math.ceil(W / RP); rep++) {
      const x = Math.round(rx - rOff + rep * RP), sp = BG.rocks[ri];
      if (x > W || x + sp.w < 0) continue;
      drawSprite(sp, x, GROUND - sp.h + 1);
    }
    // ground
    const gOff = Math.floor(G.dist) % 256;
    for (let x = -gOff; x < W; x += 256) drawBaked(skyCache.ground, x, GROUND);
    // speed streaks
    if (G.streaks.length) {
      b.fillStyle = col('streak'); b.globalAlpha = 0.7;
      for (const s of G.streaks) b.fillRect(Math.round(s.x), s.y, s.len, 1);
      b.globalAlpha = 1;
    }
    // obstacles (soft ground shadow first)
    b.fillStyle = col('gD');
    for (const o of G.obstacles) if (!o.type.flying) b.fillRect(Math.round(o.x) - 1, GROUND + 1, o.w + 2, 1);
    for (const o of G.obstacles) {
      if (o.type.flying) {
        const fr = Math.floor(o.anim / 6) % 4;
        drawSprite(bake('wig' + fr, OB.wig[fr]), o.x, o.y + (fr === 2 ? 1 : 0));
      } else {
        const sp = bake(o.type.id, OB[o.type.id]);
        for (let i = 0; i < o.size; i++) drawSprite(sp, o.x + i * o.type.w, o.y);
      }
    }
    // hero shadow
    const h = G.hero;
    const air = GROUND_Y - h.y;
    b.fillStyle = col('gD');
    const shw = Math.max(18, 52 - air * 0.35);
    b.fillRect(Math.round(HERO_X + 29 - shw / 2), GROUND + 1, Math.round(shw), 1);
    // particles behind hero
    drawParts();
    // hero
    const phase = G.mode === 'play' ? Math.floor(G.dist / 3) % 8 : 0;
    let spr, hy;
    if (G.mode === 'over') { spr = truckSprite({ dead: true, drop: 1 }); hy = h.y + (STAND_H - spr.h); }
    else if (h.ducking && !h.jumping) { spr = truckSprite({ phase, drop: 7, cabDrop: 3 }); hy = GROUND + 1 - DUCK_H; }
    else {
      let drop = 0;
      if (G.squash > 0) drop = G.squash > 4 ? 3 : G.squash > 2 ? 2 : 1;
      else if (G.mode === 'play' && !h.jumping) drop = Math.floor(G.dist / 22) % 2;
      const thrust = h.jumping && h.vy < 1;
      const blink = G.mode === 'intro' ? (G.introFrames % 50 < 25) : (nightMix > 0.5 && f % 40 < 20);
      spr = truckSprite({ phase, drop, thrust, blink });
      hy = h.y + (STAND_H - spr.h);
    }
    drawSprite(spr, HERO_X, hy);
    // night headlight beam
    if (nightMix > 0.02 && G.mode !== 'over') {
      const ducked = h.ducking && !h.jumping;
      const lx = HERO_X + 57, ly = (ducked ? hy - (35 - DUCK_H) + 22 : h.y + 15 + (G.squash > 0 ? 2 : 0));
      b.fillStyle = col('beam');
      for (let i = 0; i < 150; i++) {
        const a = nightMix * (0.32 - i / 150 * 0.3);
        if (a <= 0) break;
        b.globalAlpha = a;
        const half = 2 + i * 0.16;
        b.fillRect(lx + i, Math.round(ly - half * 0.6), 1, Math.round(half * 1.6));
      }
      b.globalAlpha = 1;
    }
    // explosion ring
    if (G.boom && G.boom.f < 14) {
      const r = 3 + G.boom.f * 2.2;
      b.fillStyle = G.boom.f < 5 ? '#fff4c4' : '#ffb347';
      for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; b.fillRect(Math.round(G.boom.x + Math.cos(a) * r), Math.round(G.boom.y + Math.sin(a) * r * 0.8), 1, 1); }
      if (G.boom.f < 3) { b.fillStyle = '#fffbe8'; b.beginPath(); b.fillRect(G.boom.x - 6, G.boom.y - 5, 12, 10); }
      G.boomDraw = true;
    }
    // HUD
    if (G.mode !== 'intro') {
      const pad = n => String(Math.min(99999, n)).padStart(5, '0');
      const sx = W - 12 * 5 - 10;
      let show = true, val = G.score;
      if (G.flash > 0) { val = G.lastMilestone; show = Math.floor(G.flash / 8) % 2 === 1; }
      if (show) text(pad(val), sx, 10, col('hud'));
      if (hiScore > 0) { text('HI', sx - 12 * 9, 10, col('hudHi')); text(pad(hiScore), sx - 12 * 6.5, 10, col('hudHi')); }
    }
    if (G.mode === 'over') {
      const gx = Math.round(W / 2 - (9 * 12 - 2) / 2), gy = 58;
      text('GAME OVER', gx + 1, gy + 1, mix('#e9cfa2', '#0b1230', nightMix));
      text('GAME OVER', gx, gy, col('hud'));
      const rx = Math.round(W / 2), ry = gy + 38;
      b.fillStyle = col('hud');
      for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
        const d = Math.hypot(x, y), a = Math.atan2(y, x);
        if (d >= 7.5 && d <= 10.5 && !(a > -1.25 && a < -0.15)) b.fillRect(rx + x, ry + y, 1, 1);
      }
      for (let i = 0; i < 6; i++) b.fillRect(rx + 4 + i - 2, ry - 9 + i - 1, 7 - i, 1); // arrow head
    }

    // compose with screen shake
    let sx = 0, sy = 0;
    if (G.shake > 0) { const amp = G.shake / 16 * 3; sx = Math.round(Math.sin(G.frame * 2.7) * amp); sy = Math.round(Math.cos(G.frame * 3.3) * amp * 0.6); }
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pageBg; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(buf, 0, 0, W, H, sx * scale, sy * scale, cv.width, cv.height);

    const a = G.mode === 'intro' ? 1 : Math.max(0, 1 - G.playFrames / 24);
    msg.style.opacity = a.toFixed(3);
    hint.style.visibility = BOT ? 'hidden' : 'visible';
  }
  function drawParts() {
    for (const p of G.parts) {
      const k = p.life / p.max;
      const key = PCOL[p.color];
      b.fillStyle = BGC[key] ? col(key) : col(key);
      const s = Math.max(1, Math.round(p.size * (p.color === 'smoke' ? (0.5 + k) : (1 - k * 0.7))));
      if (p.color === 'smoke' || p.color === 'puff' || p.color === 'dust') b.globalAlpha = Math.max(0, 1 - k) * (p.color === 'smoke' ? 0.55 : 0.9);
      const px = Math.round(p.x - s / 2), py = Math.round(p.y - s / 2);
      if (s >= 3) { b.fillRect(px + 1, py, s - 2, s); b.fillRect(px, py + 1, s, s - 2); } else b.fillRect(px, py, s, s);
      b.globalAlpha = 1;
    }
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
    while (acc >= STEP) { tick(); if (G.boom) G.boom.f++; acc -= STEP; }
    render();
    requestAnimationFrame(frame);
  }

  window.__debug = () => G;
  window.__botDebug = { simulate, POLICIES, heroBoxes, obBoxes };
  window.__state = () => ({ score: G.score, speed: +G.speed.toFixed(3), alive: G.mode !== 'over', night: !!G.night, mode: G.mode, hi: hiScore });
  window.__time = () => +(REC ? stepTime : simTime).toFixed(4);
  window.__events = () => EVENTS.slice();
  window.__start = () => { if (G.mode === 'intro') { start(); G.jumpHeld = false; heroEndJump(G.hero); } if (REC) render(); return window.__state(); };
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
      while (racc >= STEP - 1e-9) { tick(); if (G.boom) G.boom.f++; racc -= STEP; }
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
