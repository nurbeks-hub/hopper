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
  const GROUND = H - 40;

  // ---------- constants (per-frame units at 60 fps) ----------
  const HERO_X = 40, HERO_W = 64;
  const STEP = 1 / 60;
  const GRAVITY = 0.6, JUMP_V = -10, DROP_V = -5, MIN_JUMP = 30, MAX_JUMP = 63, DROP_COEF = 3;
  const SPEED0 = 6, SPEED_MAX = 11.5, ACCEL = 0.001;
  const SCORE_COEF = 0.025, CLEAR_FRAMES = 140, NIGHT_EVERY = 700, NIGHT_FRAMES = 720, GAP_COEF = 0.6, MAX_GAP_COEF = 1.5;
  const WIG_AFTER = REC ? 330 : 700; // frames of play before wigs may appear

  // ---------- palette: monochrome world, lime hero ----------
  const PAL = {
    k: '#535353',  // ink
    g: '#acacac',  // secondary grey
    l: '#dadada',  // light grey (clouds, vapor shading)
    w: '#f7f7f7',  // background
    x: '#ffffff',  // vapor core
    // pickup (Higgsfield lime)
    o: '#23271a', O: '#363c27',            // outline, trim
    V: '#efffa6', A: '#d1fe17', a: '#b7e012', d: '#9dc20f', D: '#5e7508', // specular → deep shade
    q: '#1b1f16', Q: '#3d4632', G: '#6f7a62', // window glass, glass top, glare
    t: '#262626', T: '#3a3a3a', n: '#8a8a8a', N: '#c4c4c4', // tyre, sidewall, rim, rim highlight
    X: '#ffffff', Z: '#7a1d1d',
  };
  const BG = '#f7f7f7', INK = '#535353';
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const RGB = {}; for (const k in PAL) RGB[k] = hex(PAL[k]);
  // night = invert + lift (like the original page): v -> (255 - v) + 26
  const NIGHT_LIFT = 26;
  const inv = c => c.map(v => Math.min(255, 255 - v + NIGHT_LIFT));
  const css = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const NIGHT_BG = css(inv(hex(BG))), NIGHT_INK = css(inv(hex(INK)));
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

  // ---------- hero: original pickup (lime, the only colour in the world) ----------
  const TRW = 64, TRH = 32, WHEELS = [14, 50], WCY = 24, WR = 7.4, NOZ = [27, 37], BELT0 = 12, SILL0 = 25;
  function buildTruck({ phase = 0, drop = 0, cabDrop = 0, thrust = false, dead = false, lamp = true, white = false }) {
    const g = grid(TRW, TRH);
    const belt = BELT0 + drop, sill = Math.min(SILL0 + drop, 28), roof = 3 + drop + cabDrop;
    const cabL = 28, cabR = 43, wsX = 53;
    const edge = y => Math.floor(cabR + (y - roof) * (wsX - cabR) / Math.max(1, belt - roof));
    const set = (y, x, c) => { if (y >= 0 && y < TRH && x >= 0 && x < TRW) g[y][x] = c; };
    // lower body: 5-tone metallic ramp with a crisp specular line on the shoulder
    for (let y = belt; y <= sill; y++) for (let x = 1; x <= 62; x++) {
      if (y === belt && (x === 1 || x >= 61)) continue;
      if (y === belt + 1 && x === 62) continue;
      if (y === sill && (x === 1 || x === 62)) continue;
      const r = y - belt;
      g[y][x] = r <= 1 ? 'A' : r === 2 ? 'V' : r <= 4 ? 'A' : r <= 6 ? 'a' : r === 7 ? 'D' : r <= 10 ? 'd' : 'D';
    }
    // cab with raked windshield
    for (let y = roof; y < belt; y++) for (let x = cabL; x <= edge(y); x++) {
      if (y === roof && (x <= cabL + 1 || x >= edge(y) - 1)) continue;
      if (y === roof + 1 && x === cabL) continue;
      g[y][x] = y <= roof + 1 ? 'V' : 'A';
    }
    // wheel arches
    for (const cx of WHEELS) for (let y = belt + 1; y < TRH; y++) for (let x = 0; x < TRW; x++) if (Math.hypot(x - cx, y - WCY) < 9.2) g[y][x] = null;
    outline(g, 'o');
    // dark glass, B-pillar
    for (let y = roof + 2; y <= belt - 2; y++) for (let x = cabL + 2; x <= edge(y) - 2; x++) {
      if (x === 39 || x === 40) { g[y][x] = 'O'; continue; }
      g[y][x] = y === roof + 2 ? 'Q' : 'q';
      if (!dead && ((x - y * 1.4 + 300) % 14) < 1.2) g[y][x] = 'G';
    }
    if (dead) for (const [x, y] of [[33, 1], [34, 2], [35, 2], [36, 3], [35, 4], [45, 1], [46, 2], [47, 3], [48, 3], [47, 4]]) if (roof + 2 + y <= belt - 2) g[roof + 2 + y][x] = 'N';
    // charcoal trim: fender flares, rocker, bumpers, bed/cab gap, handle
    for (let y = belt + 1; y <= sill; y++) for (let x = 0; x < TRW; x++) {
      if (!g[y][x] || g[y][x] === 'o') continue;
      if (WHEELS.some(cx => { const d = Math.hypot(x - cx, y - WCY); return d >= 9.2 && d < 10.3; })) g[y][x] = 'O';
    }
    for (let x = 2; x <= 61; x++) if (g[sill][x] && g[sill][x] !== 'o') g[sill][x] = 'O';
    for (let y = belt + 1; y <= sill - 2; y++) if (g[y][27] && g[y][27] !== 'o') g[y][27] = 'o';
    for (let y = belt + 3; y <= sill - 3; y++) if (g[y][41] && g[y][41] !== 'o' && g[y][41] !== 'O') g[y][41] = 'D';
    set(belt + 4, 43, 'O'); set(belt + 4, 44, 'O');
    for (let x = 59; x <= 63; x++) { set(sill - 1, x, x === 63 ? 'o' : 'O'); set(sill, x, 'o'); }
    for (let x = 0; x <= 2; x++) { set(sill - 1, x, 'O'); set(sill, x, 'o'); }
    for (let y = belt + 4; y <= belt + 7; y++) set(y, 62, 'O');
    // small white headlight, thin red tail light
    set(belt + 2, 61, lamp ? 'X' : 'N'); set(belt + 2, 62, lamp ? 'X' : 'N'); set(belt + 3, 62, lamp ? 'X' : 'N');
    for (let y = belt + 1; y <= belt + 4; y++) set(y, 1, 'Z');
    // chassis rail + air nozzles
    for (let x = 21; x <= 43; x++) set(sill + 1, x, 'o');
    for (const nx of NOZ) {
      for (let dy = 2; dy <= 3; dy++) for (let dx = -1; dx <= 1; dx++) set(sill + dy, nx + dx, dx === 0 ? 'T' : 'o');
      for (let dx = -1; dx <= 1; dx++) set(sill + 4, nx + dx, thrust ? (dx === 0 ? 'X' : 'N') : (dx === 0 ? 'o' : null));
    }
    // wheels: smooth tyre with tread notches, alloy rim with rotating spokes
    for (const cx of WHEELS) for (let y = WCY - 8; y <= WCY + 8; y++) for (let x = cx - 8; x <= cx + 8; x++) {
      if (y < 0 || y >= TRH) continue;
      const dx = x - cx, dy = y - WCY, rr = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
      let ch = null;
      if (rr <= WR && rr > 5.3) {
        ch = rr > 6.6 ? 't' : 'T';
        if (rr > 6.7 && Math.floor(((ang / (Math.PI * 2)) * 16 + phase / 2 + 16)) % 2 === 0) ch = 'T';
      } else if (rr <= 5.3 && rr > 1.4) {
        ch = rr > 4.4 ? 'N' : 'n';
        for (let i = 0; i < 5; i++) { const a = phase * Math.PI / 10 + i * Math.PI * 2 / 5; const px = Math.cos(a), py = Math.sin(a); const along = dx * px + dy * py, perp = Math.abs(-dx * py + dy * px); if (along > 1 && along < 4.6 && perp < 0.7) ch = 'N'; }
        if (rr <= 4.4 && dx + dy > 2.5) ch = ch === 'N' ? 'n' : 'T';
      } else if (rr <= 1.4) ch = 'o';
      if (ch) g[y][x] = ch;
    }
    if (white) for (let y = 0; y < TRH; y++) for (let x = 0; x < TRW; x++) if (g[y][x]) g[y][x] = (g[y][x] === 'o' || g[y][x] === 't') ? 'k' : 'x';
    return g;
  }
  const truckSprite = o => bake('truck' + JSON.stringify(o), cropTop(buildTruck(o)));
  const STAND_G = buildTruck({}), STAND_C = cropTop(STAND_G);
  const DUCK_G = cropTop(buildTruck({ drop: 6, cabDrop: 3 }));
  const STAND_H = STAND_C.length, DUCK_H = DUCK_G.length;
  const CROP = TRH - STAND_H;                       // rows cropped from the top of the standing sprite
  const NOZ_TIP = SILL0 + 4 - CROP;                 // nozzle tip row inside the standing sprite
  const LAMP_Y = BELT0 + 2 - CROP;
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
  // flying hairpiece: tall pompadour crest with a curl, combed-back strands, solid dark roots and a lace fringe
  const WIG_MASK = [
    '....######..................................',
    '..##########................................',
    '.#############..............................',
    '################............................',
    '#################...........................',
    '.######ww#########..........................',
    '..####w##w#########.........................',
    '...###w#ww#########.........................',
    '...####ww##########.........................',
    '...################.#.......................',
    '...##########################...............',
    '...###############################..........',
    '...######################################...',
    '...#######################################..',
    '....#####################################...',
    '.....##################################.....',
    '......RRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR......',
    '.......R.R.R.R.R.R.R.R.R.R.R.R.R.R.R........',
  ];
  function wigGrid(frame, coreOnly) {
    const w = 56, h = 27, g = grid(w, h), ox = 6, oy = 6;
    WIG_MASK.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] !== '.') g[oy + y][ox + x] = row[x] === '#' ? 'g' : row[x] === 'R' ? 'k' : 'k'; });
    outline(g, 'k', new Set(['g']));
    WIG_MASK.forEach((row, y) => { for (let x = 0; x < row.length; x++) {
      if (g[oy + y][ox + x] !== 'g') continue;
      // strands follow the swoop: arc over the crest, then run back almost flat
      const s = y + 9 * Math.exp(-(((x - 9) / 9) ** 2)) - 0.08 * x;
      if (((Math.floor(s * 0.75) % 3) + 3) % 3 === 0 && (x * 5 + y * 3) % 13 > 1) g[oy + y][ox + x] = 'k';
      else if (y < 9 && (x + y) % 4 === 0) g[oy + y][ox + x] = 'l';
    } });
    if (!coreOnly) {
      // two-frame flap: strand wings up / down
      const up = frame === 0;
      const wing = (rx, ry, dir) => {
        for (const [len, sp] of [[13, -0.25], [11, 0.05], [9, 0.35]]) {
          const a = (up ? -0.95 : 0.55) + sp;
          for (let i = 0; i <= 26; i++) {
            const t = i / 26, x = Math.round(rx + dir * Math.cos(a) * len * t), y = Math.round(ry + Math.sin(a) * len * t + Math.sin(t * Math.PI) * (up ? 1.5 : -1.2));
            if (y >= 0 && y < h && x >= 0 && x < w && !g[y][x]) g[y][x] = 'k';
            if (t < 0.5 && y + 1 < h && x >= 0 && x < w && !g[y + 1][x]) g[y + 1][x] = 'k';
          }
        }
      };
      wing(ox + 4, oy + 12, -1);
      wing(ox + 41, oy + 13, 1);
    }
    return g;
  }
  const OB = {
    cone: coneGrid(26), stack: coneGrid(38, [12, 23]), barrier: barrierGrid(), drum: drumGrid(),
    wig: [0, 1].map(f => wigGrid(f)),
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
    { id: 'wig', w: 56, h: 27, minSpeed: 0, multiSpeed: 999, maxSize: 1, minGap: 150, flying: true },
  ];
  const WIG_Y = [GROUND - 29, GROUND - 45, GROUND - 91]; // low (hop), mid (duck), high (pass)

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
  const CLOUDS = [bake('cl1', cloudGrid(3)), bake('cl2', cloudGrid(11)), bake('cl3', cloudGrid(29))];

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

  // ---------- ground tile: one ink line with bumps, dashes and pebbles ----------
  const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
  function bakeGround() {
    const GW = 600, GH = H - GROUND + 2, g = grid(GW, GH), r = mulberry(SEED ^ 0x51ed);
    for (let x = 0; x < GW; x++) g[2][x] = 'k';
    for (let i = 0; i < 9; i++) { // little bumps and dips in the line
      const x0 = Math.floor(r() * (GW - 20)), len = 4 + Math.floor(r() * 10), up = r() < 0.6;
      for (let x = x0; x < x0 + len; x++) { if (up) { g[1][x] = 'k'; g[2][x] = (x === x0 || x === x0 + len - 1) ? 'k' : null; } else { g[2][x] = null; g[3][x] = 'k'; } }
    }
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(r() * (GW - 4)), y = 5 + Math.floor(r() * (GH - 9)), len = r() < 0.5 ? 1 : 1 + Math.floor(r() * 3);
      for (let k = 0; k < len; k++) g[y][x + k] = r() < 0.35 ? 'g' : 'k';
    }
    tiles.ground = bake('ground' + H, g);
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
      obstacles: [], lastTypes: [], parts: [], blobs: [], clouds: [],
      night: false, nightFrames: 0, nextNight: NIGHT_EVERY, stars: [], moon: 0,
      flash: 0, jumpHeld: false, duckHeld: false, plan: null, squash: 0, shake: 0, boom: null,
      hitStop: 0, hitFlash: 0, knock: 0, knockV: 0,
    };
    const r = mulberry(SEED ^ 0xc10d);
    for (let i = 0; i < 4; i++) G.clouds.push({ x: 40 + i * 170 + r() * 80, y: 18 + Math.floor(r() * (GROUND - 110)), i: i % 3 });
    makeStars();
  }
  function makeStars() {
    const r = mulberry(SEED ^ (G.nextNight * 7));
    G.stars = [];
    for (let i = 0; i < 26; i++) G.stars.push({ x: Math.floor(r() * 1100), y: 8 + Math.floor(r() * (GROUND - 90)), tw: Math.floor(r() * 120), big: r() < 0.2 });
  }
  function start() { if (G.mode !== 'intro') return; G.mode = 'play'; G.playFrames = 0; doJump(); }
  function restart() { newGame(false); }
  // compressed-air vapor: metaball blobs rendered as a dithered pixel cloud with an ink outline
  function blob(x, y, vx, vy, r0, r1, grow, max, dens, kind = 'vapor', drift = 0.3) {
    G.blobs.push({ x, y, vx, vy, r0, r1, grow, max, dens, kind, drift, age: 0 });
  }
  function hopBurst() {
    const base = GROUND - 2, cx = HERO_X + (NOZ[0] + NOZ[1]) / 2;
    for (const nx of NOZ) {
      const x = HERO_X + nx;
      blob(x, base - 7, 0, 1.4, 3, 8, 4, 22, 1.5);                        // jets slamming into the ground
      blob(x, base - 2, 0, 0.3, 4, 10, 5, 34, 1.4);
    }
    // the main billow: a cluster of overlapping puffs so the outline reads as one lumpy cloud
    for (let i = 0; i < 7; i++) {
      const ox = (i - 3) * 6 + (fxRng() - 0.5) * 4;
      blob(cx + ox, base - 2 - fxRng() * 6, ox * 0.09, -0.25 - fxRng() * 0.45, 4, 11 + fxRng() * 7, 8 + fxRng() * 4, 50 + fxRng() * 18, 1.25);
    }
    for (let i = 0; i < 6; i++) {                                          // ground-hugging roll-out both ways
      const dir = i % 2 ? 1 : -1, sp = 0.9 + fxRng() * 1.4;
      blob(cx + dir * (12 + fxRng() * 8), base - 1, dir * sp, -0.1 - fxRng() * 0.2, 3, 8 + fxRng() * 5, 9, 40 + fxRng() * 18, 1.1);
    }
    for (let i = 0; i < 3; i++) blob(cx - 12 + fxRng() * 24, base - 12, -0.4 + fxRng() * 0.8, -0.5 - fxRng() * 0.4, 3, 7 + fxRng() * 4, 10, 40, 0.95);
  }
  function doJump() {
    if (heroJump(G.hero, G.speed)) {
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
      if (G.deadFrames % 10 === 0 && G.deadFrames < 110) blob(HERO_X + G.knock + NOZ[(G.deadFrames / 10) % 2], GROUND - 4, -0.3, -0.5, 2, 6, 10, 40, 0.75, 'vapor', 0);
      updateParts(0); updateBlobs(0);
      if (BOT && G.deadFrames > 110) restart();
      return;
    }
    G.playFrames++;
    if (BOT) botThink();
    // thrust column on take-off, then a small continuous steam wisp from the nozzles while airborne
    if (h.jumping) {
      for (const nx of NOZ) {
        if (h.vy < -5) { blob(HERO_X + nx, h.y + NOZ_TIP + 4, 0, 3.4, 4, 9, 4, 18, 1.4); blob(HERO_X + nx, (h.y + NOZ_TIP + GROUND) / 2, 0, 2, 4, 8, 4, 16, 1.3); }
        else if (G.playFrames % 2 === 0) blob(HERO_X + nx, h.y + NOZ_TIP + 2, -0.2, 1.0, 2, 5, 6, 18, 1.0, 'wisp');
      }
    }
    const landed = heroStep(h);
    if (landed) {
      if (!G.duckHeld) h.ducking = false;
      G.squash = 7;
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

    const sc = Math.floor(G.dist * SCORE_COEF);
    if (sc !== G.score) {
      G.score = sc;
      if (sc > 0 && sc % 100 === 0 && sc !== G.lastMilestone) { G.lastMilestone = sc; G.flash = 60; SFX.point(); ev('point100'); }
      if (sc >= G.nextNight) { G.nextNight += NIGHT_EVERY; G.night = true; G.nightFrames = NIGHT_FRAMES; G.moon = (G.moon + 1) % 4; makeStars(); }
    }
    if (G.flash > 0) G.flash--;
    if (G.night) { G.nightFrames--; if (G.nightFrames <= 0) G.night = false; }

    for (const c of G.clouds) {
      c.x -= sp * 0.2;
      if (c.x < -50) { c.x = W + 20 + fxRng() * 220; c.y = 18 + Math.floor(fxRng() * (GROUND - 110)); c.i = Math.floor(fxRng() * 3); }
    }
    updateParts(sp); updateBlobs(sp);
  }
  function landDust(k) {
    for (const wx of WHEELS) for (const dir of [-1, 1]) blob(HERO_X + G.knock + wx + dir * 3, GROUND - 2, dir * (1 + fxRng() * 1.6) * k, -0.25, 2, (5 + fxRng() * 3) * (0.6 + 0.4 * k), 6, 26, 1, 'dust', 0.35);
    if (k >= 1) blob(HERO_X + (NOZ[0] + NOZ[1]) / 2, GROUND - 3, 0, -0.2, 3, 9, 8, 28, 0.95);
    for (let i = 0; i < 5 * k; i++) part(HERO_X + 6 + fxRng() * 54, GROUND - 1, (fxRng() - 0.5) * 2.6, -1 - fxRng() * 1.4, 22, fxRng() < 0.6 ? 'ink' : 'grey', 1, 0.16);
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
    h.vy = Math.min(h.vy, 0) - 3.2; h.jumping = false; G.knockV = -1.5; G.knock = 0;
    const cx = Math.max(HERO_X + HERO_W - 6, o.x + 4), cy = Math.min(h.y + 14, GROUND - 10);
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
  const PCOL = { ink: PAL.k, grey: PAL.g };
  function text(str, x, y, color, sc = 2) {
    b.fillStyle = color;
    for (const ch of str) {
      const gl = FONT[ch];
      if (gl) for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (gl[r][c] === '#') b.fillRect(x + c * sc, y + r * sc, sc, sc);
      x += 6 * sc;
    }
  }
  // night is a dithered horizontal wipe of an inverted palette (no alpha dissolve)
  function nightEdge() {
    const m = nightMix;
    return G.night ? { from: 'right', e: W - m * (W + 10) } : { from: 'left', e: m * (W + 10) };
  }
  function isNight(x, y, ne) {
    if (nightMix <= 0) return false;
    if (nightMix >= 1) return true;
    const th = (BAYER[y & 3][x & 3] + 0.5) / 16 * 8;
    return ne.from === 'right' ? x > ne.e + th : x < ne.e - th;
  }
  function invertPass(ne) {
    if (nightMix <= 0) return;
    const ops = [['difference', '#ffffff'], ['lighter', `rgb(${NIGHT_LIFT},${NIGHT_LIFT},${NIGHT_LIFT})`]];
    for (const [op, fill] of ops) {
      b.globalCompositeOperation = op; b.fillStyle = fill;
      if (nightMix >= 1) { b.fillRect(0, 0, W, H); continue; }
      const e = Math.round(ne.e);
      if (ne.from === 'right') { if (e + 9 < W) b.fillRect(Math.max(0, e + 9), 0, W - Math.max(0, e + 9), H); }
      else if (e - 9 > 0) b.fillRect(0, 0, Math.min(W, e - 9), H);
      for (let x = Math.max(0, e - 9); x <= Math.min(W - 1, e + 9); x++) for (let y = 0; y < H; y++) if (isNight(x, y, ne)) b.fillRect(x, y, 1, 1);
    }
    b.globalCompositeOperation = 'source-over';
  }
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
    const C = { k: RGB.k, g: RGB.g, l: RGB.l, w: RGB.w, x: RGB.x };
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
      if (nightAware && isNight(gx, gy, ne)) c = inv(c);
      const o = i * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    vctx.putImageData(img, 0, 0);
    b.drawImage(vbuf, 0, 0, bw, bh, x0, y0, bw, bh);
  }
  function drawSprite(sp, x, y) { b.drawImage(sp.c, Math.round(x), Math.round(y)); }
  function render() {
    if (tiles.w !== W || !tiles.ground) bakeGround();
    const ne = nightEdge();
    const dark = nightMix > 0.5;
    const pageBg = dark ? NIGHT_BG : BG;
    document.body.style.background = pageBg;
    document.documentElement.style.setProperty('--fg', dark ? NIGHT_INK : INK);
    document.documentElement.style.setProperty('--muted', dark ? '#9a9a9a' : '#8a8a8a');

    const f = G.frame, h = G.hero;
    b.fillStyle = BG; b.fillRect(0, 0, W, H);
    // stars + moon exist only inside the night region (drawn in ink, the inversion lights them)
    if (nightMix > 0) {
      b.fillStyle = PAL.k;
      for (const s of G.stars) {
        if (s.x > W || !isNight(s.x, s.y, ne)) continue;
        b.fillRect(s.x, s.y, 1, 1);
        if (s.big || (f + s.tw) % 120 < 14) { b.fillRect(s.x - 1, s.y, 3, 1); b.fillRect(s.x, s.y - 1, 1, 3); }
      }
      const mx = Math.round(W * 0.72), my = Math.round(GROUND * 0.22);
      const ph = [5, 3, -3, -5][G.moon];
      for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
        const dd = Math.hypot(x, y), d2 = Math.hypot(x + ph, y - 1);
        if (dd <= 9.5 && d2 > 8.5 && isNight(mx + x, my + y, ne)) { b.fillStyle = dd > 8.3 ? PAL.g : PAL.k; b.fillRect(mx + x, my + y, 1, 1); }
      }
    }
    // sparse clouds
    for (const c of G.clouds) drawSprite(CLOUDS[c.i], c.x, c.y);
    // ground
    const gOff = Math.floor(G.dist) % 600;
    for (let x = -gOff; x < W; x += 600) drawSprite(tiles.ground, x, GROUND - 2);
    // obstacles
    for (const o of G.obstacles) {
      if (o.type.flying) {
        const fr = Math.floor(o.anim / 10) % 2;
        drawSprite(bake('wig' + fr, OB.wig[fr]), o.x, o.y + (fr ? 2 : 0));
      } else {
        const sp = bake(o.type.id, OB[o.type.id]);
        for (let i = 0; i < o.size; i++) drawSprite(sp, o.x + i * o.type.w, o.y);
      }
    }
    // airborne shadow dash
    const air = GROUND_Y - h.y;
    if (air > 2) { const shw = Math.max(16, 50 - air * 0.4); b.fillStyle = PAL.g; b.fillRect(Math.round(HERO_X + 32 - shw / 2), GROUND + 2, Math.round(shw), 1); }
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
      if (show) text(pad(val), sx, HUDM, PAL.k);
      if (hiScore > 0) { text('HI', sx - 12 * 9, HUDM, PAL.g); text(pad(hiScore), sx - 12 * 6.5, HUDM, PAL.g); }
    }
    if (G.mode === 'over') {
      const gx = Math.round(W / 2 - (9 * 12 - 2) / 2), gy = Math.round(GROUND * 0.34);
      text('GAME OVER', gx, gy, PAL.k);
      const rx = Math.round(W / 2), ry = gy + 40;
      b.fillStyle = PAL.k;
      for (let y = -11; y <= 11; y++) for (let x = -11; x <= 11; x++) {
        const d = Math.hypot(x, y), a = Math.atan2(y, x);
        if (d >= 7.5 && d <= 10.5 && !(a > -1.25 && a < -0.15)) b.fillRect(rx + x, ry + y, 1, 1);
      }
      for (let i = 0; i < 6; i++) b.fillRect(rx + 4 + i - 2, ry - 9 + i - 1, 7 - i, 1); // arrow head
    }
    invertPass(ne);

    // hero: the only colour in the world (drawn after the inversion)
    const phase = G.mode === 'play' ? Math.floor(G.dist / 3) % 10 : 0;
    let spr, hy, hx = HERO_X, heroDrop = 0;
    if (G.mode === 'over') {
      spr = truckSprite(G.hitFlash > 0 ? { dead: true, drop: 1, white: true } : { dead: true, drop: 1, lamp: false });
      hy = Math.round(h.y) + (STAND_H - spr.h); hx = HERO_X + Math.round(G.knock);
    } else if (h.ducking && !h.jumping) { spr = truckSprite({ phase, drop: 6, cabDrop: 3 }); hy = GROUND + 1 - DUCK_H; }
    else {
      let drop = 0;
      if (G.squash > 0) drop = G.squash > 4 ? 2 : 1;
      else if (G.mode === 'play' && !h.jumping) drop = Math.floor(G.dist / 26) % 2;
      const thrust = h.jumping && h.vy < 1;
      const lamp = G.mode === 'intro' ? (G.introFrames % 50 < 25) : true;
      spr = truckSprite({ phase, drop, thrust, lamp }); heroDrop = drop;
      hy = h.y + (STAND_H - spr.h);
    }
    drawBlobs('wisp', false, ne);
    drawSprite(spr, hx, hy);
    // night headlight beam
    if (nightMix > 0.5 && G.mode !== 'over') {
      const ducked = h.ducking && !h.jumping;
      const lx = HERO_X + 63, ly = hy + BELT0 + 2 + (ducked ? 6 : heroDrop) - (TRH - spr.h);
      b.fillStyle = '#ffffff';
      for (let i = 0; i < 120; i++) {
        const a = 0.16 - i / 120 * 0.15; if (a <= 0) break;
        b.globalAlpha = a; const half = 1 + i * 0.14;
        b.fillRect(lx + i, Math.round(ly - half * 0.6), 1, Math.round(half * 1.6));
      }
      b.globalAlpha = 1;
    }
    drawBlobs('vapor', false, ne);

    // compose with screen shake (underlay the unshifted frame so no page strip shows)
    let sx = 0, sy = 0;
    if (G.shake > 0) { const amp = G.shake / 14 * 3; sx = Math.round(Math.sin(G.frame * 2.7) * amp); sy = Math.round(Math.cos(G.frame * 3.3) * amp * 0.6); }
    ctx.imageSmoothingEnabled = false;
    if (sx || sy) ctx.drawImage(buf, 0, 0, W, H, 0, 0, cv.width, cv.height);
    ctx.drawImage(buf, 0, 0, W, H, sx * scale, sy * scale, cv.width, cv.height);

    const a = G.mode === 'intro' ? 1 : Math.max(0, 1 - G.playFrames / 24);
    msg.style.opacity = a.toFixed(3);
    hint.style.visibility = BOT ? 'hidden' : 'visible';
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
