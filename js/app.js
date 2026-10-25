(() => {
  'use strict';

  // ---------- World constants ----------
  const WORLD_R = 10000;          // Valheim world radius in meters, spawn at the center
  const CELL = 10;                // meters per paint cell
  const N = 2048;                 // paint grid is N x N cells
  const HALF = (N * CELL) / 2;    // grid spans -HALF..HALF meters on both axes
  const SIZES = [                 // brush radius in meters (10 m = one paint cell, the smallest)
    { m: 10, name: 'Tiniest', dot: 3 },
    { m: 20, name: 'Very tiny', dot: 5 },
    { m: 40, name: 'Tiny', dot: 8 },
    { m: 120, name: 'Small', dot: 12 },
    { m: 300, name: 'Big', dot: 17 },
    { m: 700, name: 'Huge', dot: 23 },
    { m: 1500, name: 'Giant', dot: 30 },
  ];
  const MAX_ZOOM = 1.6;           // px per meter
  const MARKER_R = 10;            // marker radius in screen px at full size
  const BOSS_R = 12;
  const MARKER_FULL_ZOOM = 0.15;  // px per meter at which markers reach full size
  const MARKER_MIN_K = 0.12;      // smallest marker scale when zoomed out (a tiny dot)
  const DOT_R = 6;                // below this radius a marker is drawn as a plain dot, no picture
  const LABEL_K = 0.75;           // marker scale at which default labels appear
  const CUSTOM_LABEL_K = 0.45;    // marker scale at which names you typed appear
  const GOLD = '#f2c14e';
  const AUTOSAVE_KEY = 'valmap.autosave.v1';
  const UNDO_LIMIT = 60;

  // Details drawn on top of the land. Each cell has a detail byte with one bit per detail of its
  // biome (bit n = the biome's n-th detail in CATALOG), so several details can stack in a cell.
  const D_NONE = 0;

  // Sharp rendering when zoomed in: the map is redrawn in tiles at screen resolution.
  const TILE_PX = 512;            // tile image size; a tile covers TILE_PX / u cells
  const TILE_MIN_CELL_PX = 1.25;  // below this many device px per cell, the overview image is enough
  const MAX_TILES = 150;          // cached tiles (about 1 MB of GPU memory each)
  const TILE_BUDGET_MS = 8;       // tile rendering time per frame
  const TREE_SPACING = 4;         // cells between tree spots
  const DETAIL_REACH = 19;        // cells a tree or symbol drawing can stick out of its spot (peaks)
  const DETAIL_PX = 2;            // screen px per cell at which trees and symbols stop growing:
                                  // zooming in further shows more of them, not bigger ones

  // ---------- Catalog lookups ----------
  const BIOMES = CATALOG.biomes;
  const biomeById = {};
  const biomeByKey = {};
  for (const b of BIOMES) { biomeById[b.id] = b; biomeByKey[b.key] = b; }

  // ---------- Details ----------
  const DETAILS = CATALOG.details;
  const detailsOf = b => biomeById[b].details || [];
  const detailBit = (b, kind) => { const n = detailsOf(b).indexOf(kind); return n < 0 ? 0 : 1 << n; };
  // Per biome (and per render class, which is 0 for areas): which bits are trees, symbols, areas.
  const TREE_MASK = new Uint8Array(16), GLYPH_MASK = new Uint8Array(16), AREA_MASK = new Uint8Array(16);
  const ALL_MASK = new Uint8Array(16);
  for (const b of BIOMES) {
    detailsOf(b.id).forEach((kind, n) => {
      const type = DETAILS[kind].type;
      const mask = type === 'tree' ? TREE_MASK : type === 'glyph' ? GLYPH_MASK : AREA_MASK;
      mask[b.id] |= 1 << n;
      ALL_MASK[b.id] |= 1 << n;
    });
  }
  // Kinds of a type present in a detail byte: KINDS_IN[type][biome * 256 + bits].
  const KINDS_IN = { tree: [], glyph: [] };
  for (const b of BIOMES) {
    for (let d = 0; d < 256; d++) {
      for (const type of ['tree', 'glyph']) {
        KINDS_IN[type][b.id * 256 + d] = detailsOf(b.id).filter((k, n) => d & (1 << n) && DETAILS[k].type === type);
      }
    }
  }

  // Areas (lava, bog water, ice, mist) get their own render classes after the biome ids (0..8),
  // so their borders are traced like coastlines. CLASS_OF[biome * 256 + detail] = render class.
  const AREA_CLASS = {};
  let nextClass = 9;
  for (const [kind, d] of Object.entries(DETAILS)) if (d.type === 'area') AREA_CLASS[kind] = nextClass++;
  const LAVA = AREA_CLASS.lava;
  const NUM_CLASSES = nextClass;
  const CLASS_OF = new Uint8Array(16 * 256);
  for (const b of BIOMES) {
    for (let d = 0; d < 256; d++) {
      const areas = detailsOf(b.id).filter((k, n) => d & (1 << n) && DETAILS[k].type === 'area');
      CLASS_OF[b.id * 256 + d] = areas.length ? AREA_CLASS[areas[0]] : b.id;
    }
  }

  // How each tree kind sits on the map: height scale and share of tree spots it fills.
  const TREE_LOOK = {
    beech: { size: 1.0, density: 0.7 },
    birch: { size: 0.95, density: 0.55 },
    oak: { size: 1.9, density: 0.3 },
    fir: { size: 1.2, density: 0.85 },
    pine: { size: 1.4, density: 0.6 },
    snowfir: { size: 1.2, density: 0.75 },
  };
  // Map symbols: cells between spots, height range in cells, share of spots used, hash salt.
  const GLYPH_LOOK = {
    boulders: { spacing: 9, size: [2.5, 4], density: 0.45, salt: 31 },
    deadtree: { spacing: 8, size: [6, 9], density: 0.6, salt: 32 },
    peak: { spacing: 15, size: [12, 18], density: 0.8, salt: 33 },
    hill: { spacing: 11, size: [4.5, 6.5], density: 0.7, salt: 34 },
    rocks: { spacing: 10, size: [3, 5], density: 0.5, salt: 35 },
    cliff: { spacing: 11, size: [9, 14], density: 0.65, salt: 36 },
    shoot: { spacing: 13, size: [8, 12], density: 0.5, salt: 37 },
    ashwood: { spacing: 7, size: [4.5, 6.5], density: 0.6, salt: 38 },
    snowhill: { spacing: 11, size: [4.5, 6.5], density: 0.7, salt: 39 },
  };

  // ---------- Game look (optional art from your own Valheim install, see tools/build-game-assets.js) ----------
  const GAME = window.GAME_ASSETS || null;
  const gameImg = {};              // picture name -> loaded Image
  const gameTex = {};              // texture name -> { w, h, px } pixels, for drawing tiles
  let gameLook = false;            // true once the art has loaded and the look is switched on
  const GAME_BADGE = '#1d1610';   // dark disc behind game pictures
  const MOUNTAIN = biomeByKey.mountain.id;
  const FOREST_REPEAT = 32;        // cells per repeat of the game's forest texture
  const MOUNT_REPEAT = 48;         // cells per repeat of the mountain texture
  const MOUNT_STREAKS = 0.16;      // how much the rock streaks darken the snowy white
  const WATER_REPEAT_M = 500;      // meters per repeat of the water texture
  const PAPER_REPEAT_M = 2500;     // meters per repeat of the parchment texture
  // How each tree kind tints and scales the game's forest texture (oaks are drawn bigger).
  const FOREST_LOOK = {
    beech: { tint: [1.15, 1.25, 0.95], scale: 1, shift: 0 },
    birch: { tint: [2.3, 1.75, 0.55], scale: 0.9, shift: 7 },
    oak: { tint: [0.8, 0.95, 0.7], scale: 1.6, shift: 13 },
    fir: { tint: [0.6, 0.85, 0.8], scale: 1, shift: 19 },
    pine: { tint: [1.0, 0.85, 0.6], scale: 1.2, shift: 23 },
    snowfir: { tint: [0.95, 1.15, 1.25], scale: 1, shift: 29 },
  };

  const placeByKey = {};
  for (const p of CATALOG.common) placeByKey[p.key] = { ...p, biome: null };
  for (const [bk, list] of Object.entries(CATALOG.places)) {
    for (const p of list) placeByKey[p.key] = { ...p, biome: bk };
  }

  const placeBadge = def => def.badge || (def.biome ? biomeByKey[def.biome].badge : '#4a3b2a');
  const placeRadius = def => (def.boss ? BOSS_R : MARKER_R);
  // Markers shrink along with the map when zooming out, so they never hide the land.
  const markerK = s => Math.max(MARKER_MIN_K, Math.min(1, (s / MARKER_FULL_ZOOM) ** 1.4));

  // ---------- State ----------
  const grid = new Uint8Array(N * N);   // biome id per cell, 0 = ocean
  const detail = new Uint8Array(N * N); // detail bits per cell (see Details)
  let markers = [];                     // { id, type, x, z, label }
  let nextId = 1;
  let worldName = '';
  const view = { x: 0, z: 0, s: 0.04 }; // center in world meters, s = screen px per meter
  let showRings = true;
  let showPlaces = true;
  let biome = 1;
  let layer = 'land';                   // 'land', or the detail key the brush adds (e.g. 'oak', 'peak')
  let sizeIdx = 4;                      // Big
  let tool = 'brush';                   // brush | fill | move
  let placing = null;                   // place key while placing a marker
  let selectedId = null;

  // Cells inside the round world.
  const inWorld = new Uint8Array(N * N);
  for (let gy = 0; gy < N; gy++) {
    const wz = HALF - (gy + 0.5) * CELL;
    for (let gx = 0; gx < N; gx++) {
      const wx = (gx + 0.5) * CELL - HALF;
      if (wx * wx + wz * wz <= WORLD_R * WORLD_R) inWorld[gy * N + gx] = 1;
    }
  }

  // Render class of a cell: its biome, or an area drawn on it (lava, bog water...).
  const clsAt = i => CLASS_OF[grid[i] * 256 + detail[i]];
  // Detail bits drawn as trees or symbols, so cell changes must redraw further around them.
  const drawnMask = b => GLYPH_MASK[b] | (gameLook ? 0 : TREE_MASK[b]);

  // ---------- Colors ----------
  function hexRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  // Packed pixel for a little-endian Uint32 view of RGBA bytes.
  const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const shade = (rgb, f) => rgb.map(c => Math.max(0, Math.min(255, Math.round(c * f))));

  const BASE_RGB = [];
  const EDGE_RGB = [];
  for (const b of BIOMES) {
    BASE_RGB[b.id] = hexRgb(b.color);
    EDGE_RGB[b.id] = shade(BASE_RGB[b.id], 0.62);
  }
  for (const [kind, c] of Object.entries(AREA_CLASS)) {
    BASE_RGB[c] = hexRgb(DETAILS[kind].color);
    EDGE_RGB[c] = hexRgb(DETAILS[kind].edge);
  }
  const FOAM_RGB = [232, 244, 249];

  // Overview pixels (one per cell).
  const FILL = new Uint32Array(16);
  const EDGE = new Uint32Array(16);
  const TREE_FILL = new Uint32Array(16);
  const TREE_DOT = new Uint32Array(16);
  for (let c = 1; c < NUM_CLASSES; c++) {
    if (!BASE_RGB[c]) continue;
    FILL[c] = pack(...BASE_RGB[c]);
    EDGE[c] = pack(...EDGE_RGB[c]);
    TREE_FILL[c] = pack(...shade(BASE_RGB[c], 0.84));
    TREE_DOT[c] = pack(...shade(BASE_RGB[c], 0.55));
  }
  const FOAM = pack(...FOAM_RGB, 170);

  // Small integer hash -> [0, 1)
  function hash(x, y, salt) {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 2147483647);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }

  // ---------- Overview image (one pixel per cell, used when zoomed out) ----------
  const bioCanvas = document.createElement('canvas');
  bioCanvas.width = bioCanvas.height = N;
  const bioCtx = bioCanvas.getContext('2d');
  const bioImg = bioCtx.createImageData(N, N);
  const bioPix = new Uint32Array(bioImg.data.buffer);

  // Recolor a rectangle of cells (inclusive), plus a 1-cell border for coastlines.
  // `far`: the change involved trees or symbols, whose drawings reach beyond their cells.
  function redrawCells(x0, y0, x1, y1, far = true) {
    x0 = Math.max(0, x0 - 1); y0 = Math.max(0, y0 - 1);
    x1 = Math.min(N - 1, x1 + 1); y1 = Math.min(N - 1, y1 + 1);
    for (let y = y0; y <= y1; y++) {
      const up = y > 0 ? -N : 0;
      const down = y < N - 1 ? N : 0;
      for (let x = x0; x <= x1; x++) {
        const i = y * N + x;
        if (!inWorld[i]) { bioPix[i] = 0; continue; }
        const v = clsAt(i);
        const l = x > 0 ? -1 : 0;
        const r = x < N - 1 ? 1 : 0;
        const border =
          clsAt(i + l) !== v || clsAt(i + r) !== v ||
          clsAt(i + up) !== v || clsAt(i + down) !== v ||
          clsAt(i + up + l) !== v || clsAt(i + up + r) !== v ||
          clsAt(i + down + l) !== v || clsAt(i + down + r) !== v;
        if (v === 0) bioPix[i] = border ? FOAM : 0;
        else if (border) bioPix[i] = EDGE[v];
        else if (detail[i] & (TREE_MASK[v] | GLYPH_MASK[v])) bioPix[i] = (x * 3 + y * 5) % 7 === 0 ? TREE_DOT[v] : TREE_FILL[v];
        else bioPix[i] = FILL[v];
      }
    }
    bioCtx.putImageData(bioImg, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    invalidateTiles(x0, y0, x1, y1, far);
  }
  const redrawAllCells = () => redrawCells(0, 0, N - 1, N - 1);

  // ---------- Sharp tiles (used when zoomed in) ----------
  // The map is redrawn in 512 px tiles at `u` device pixels per cell (u = 2, 4, 8 or 16),
  // so one tile covers 512/u cells. Borders between biomes are traced with a smooth
  // cubic B-spline over the cells, so coastlines stay round and crisp at any zoom.
  // Finished tiles are kept as ImageBitmaps, which the GPU draws cheaply.
  const tileCache = new Map();
  let frameNo = 0;
  const tileKey = (u, tx, ty) => u * 1000000 + ty * 1000 + tx;
  const tileCells = u => TILE_PX / u;

  // Mark the cells that changed in every cached tile. A tile remembers the changed area
  // (dirtyRect) so only that part is redrawn; dirtyRect null with dirty set means the whole tile.
  function invalidateTiles(x0, y0, x1, y1, far = true) {
    // Smooth borders reach 3 cells; drawn trees and symbols reach further.
    const m = (far ? DETAIL_REACH : 0) + 3;
    x0 -= m; y0 -= m; x1 += m; y1 += m;
    for (const t of tileCache.values()) {
      const cpt = tileCells(t.u);
      const cx0 = t.tx * cpt, cy0 = t.ty * cpt, cx1 = cx0 + cpt - 1, cy1 = cy0 + cpt - 1;
      if (cx0 > x1 || cx1 < x0 || cy0 > y1 || cy1 < y0) continue;
      const r = { x0: Math.max(x0, cx0), y0: Math.max(y0, cy0), x1: Math.min(x1, cx1), y1: Math.min(y1, cy1) };
      if (!t.dirty) {
        t.dirtyRect = r;
        t.dirtySince = performance.now();
      } else if (t.dirtyRect) {
        const d = t.dirtyRect;
        d.x0 = Math.min(d.x0, r.x0); d.y0 = Math.min(d.y0, r.y0);
        d.x1 = Math.max(d.x1, r.x1); d.y1 = Math.max(d.y1, r.y1);
      }
      t.dirty = true;
    }
  }

  function dropTile(key, t) {
    if (t.bmp && t.bmp.close) t.bmp.close();
    tileCache.delete(key);
  }

  function clearTiles() {
    for (const [key, t] of [...tileCache]) dropTile(key, t);
  }

  // Per-pixel paper grain from a small repeating table (0..7).
  const NOISE_SIZE = 128;
  const NOISE = new Uint8Array(NOISE_SIZE * NOISE_SIZE);
  for (let i = 0; i < NOISE.length; i++) NOISE[i] = Math.floor(hash(i % NOISE_SIZE, Math.floor(i / NOISE_SIZE), 7) * 8);
  const grain = k => 1 + (k / 7 - 0.5) * 0.07;

  // Ready-made pixels for plain land: [class][under trees 0/1][grain 0..7].
  const PLAIN = new Uint32Array(16 * 2 * 8);
  for (let c = 1; c < NUM_CLASSES; c++) {
    if (!BASE_RGB[c] || c === LAVA) continue;
    for (let tr = 0; tr < 2; tr++) {
      for (let k = 0; k < 8; k++) {
        const f = grain(k) * (tr && TREE_MASK[c] ? 0.87 : 1);
        const [r, g, b] = BASE_RGB[c];
        PLAIN[(c * 2 + tr) * 8 + k] = pack(Math.min(255, r * f) | 0, Math.min(255, g * f) | 0, Math.min(255, b * f) | 0);
      }
    }
  }

  // One shared drawing surface; each finished tile is moved off it as an ImageBitmap.
  let surf = null, surfCtx = null, surfImg = null, surfPix = null;
  function surface() {
    if (surf) return;
    surf = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TILE_PX, TILE_PX) : document.createElement('canvas');
    surf.width = surf.height = TILE_PX;
    surfCtx = surf.getContext('2d');
    surfImg = surfCtx.createImageData(TILE_PX, TILE_PX);
    surfPix = new Uint32Array(surfImg.data.buffer);
  }

  // Cubic B-spline weights for fraction t.
  function bspline(t, out, o) {
    const t2 = t * t, t3 = t2 * t;
    out[o] = (1 - t) * (1 - t) * (1 - t) / 6;
    out[o + 1] = (3 * t3 - 6 * t2 + 4) / 6;
    out[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
    out[o + 3] = t3 / 6;
  }

  function renderTile(t) {
    const { u, tx, ty } = t;
    const cpt = tileCells(u);
    const size = TILE_PX;
    surface();
    const pix = surfPix;

    // Local copy of classes and tree flags, 2 cells of margin on each side.
    const ox = tx * cpt - 2, oy = ty * cpt - 2;
    const LW = cpt + 4;
    const cb = new Uint8Array(LW * LW);
    const tb = new Uint8Array(LW * LW);
    const tm = new Uint8Array(LW * LW);   // tree kind bits, for the game look
    for (let lj = 0; lj < LW; lj++) {
      const gy = oy + lj;
      if (gy < 0 || gy >= N) continue;
      for (let li = 0; li < LW; li++) {
        const gx = ox + li;
        if (gx < 0 || gx >= N) continue;
        const i = gy * N + gx;
        if (!inWorld[i]) continue;
        const c = clsAt(i);
        cb[lj * LW + li] = c;
        // c is the biome id unless an area covers the cell (then there are no trees: TREE_MASK is 0).
        const bits = detail[i] & TREE_MASK[c];
        tb[lj * LW + li] = bits ? 1 : 0;
        tm[lj * LW + li] = bits;
      }
    }

    // For each 4x4 sample block: its class (and tree flag) if uniform, else 255.
    const UW = cpt + 1;
    const uni = new Uint8Array(UW * UW);
    const tuni = new Uint8Array(UW * UW);
    for (let bj = 0; bj < UW; bj++) {
      for (let bi = 0; bi < UW; bi++) {
        const c0 = cb[bj * LW + bi], t0 = tb[bj * LW + bi];
        let same = true, tsame = true;
        for (let n = 0; n < 4; n++) {
          for (let m = 0; m < 4; m++) {
            const k = (bj + n) * LW + bi + m;
            if (cb[k] !== c0) same = false;
            if (tb[k] !== t0) tsame = false;
          }
        }
        uni[bj * UW + bi] = same ? c0 : 255;
        tuni[bj * UW + bi] = tsame ? t0 : 255;
      }
    }

    // Per-column and per-row sample positions and weights.
    const colB = new Int32Array(size), rowB = new Int32Array(size);
    const colW = new Float32Array(size * 4), rowW = new Float32Array(size * 4);
    for (let p = 0; p < size; p++) {
      const f = (p + 0.5) / u - 0.5 + 2;  // in local cell coords (cell centers at integers)
      const f0 = Math.floor(f);
      colB[p] = rowB[p] = f0 - 1;
      bspline(f - f0, colW, p * 4);
      bspline(f - f0, rowW, p * 4);
    }

    // Outline widths in "margin" units: the class margin changes ~1.33 per cell.
    const perPx = 1.33 / u;
    const edgeW = perPx * 1.6;
    const foamW = perPx * 4.5;
    const aaW = perPx * 0.75;

    const acc = new Float32Array(16);
    const gpx0 = tx * size, gpy0 = ty * size;
    const rgba = [0, 0, 0, 0];
    const rgba2 = [0, 0, 0, 0];

    // Game look: the game's own forest and mountain textures, tiled in world cells.
    const GL = gameLook;
    const FOREST = GL && gameTex.forest, MOUNT = GL && gameTex.mountain;
    // Texture pixel index for a point in cells; k = texture pixels per cell (wraps around).
    const texAt = (T, k, x, y) => ((((y * k) | 0) % T.h) * T.w + (((x * k) | 0) % T.w)) * 4;
    const mountK = MOUNT ? MOUNT.w / MOUNT_REPEAT : 0;
    const forestK = {};
    // Like drawn trees, the forest texture stops growing past DETAIL_PX: it repeats more instead.
    const shrink = Math.min(u, DETAIL_PX) / u;
    if (FOREST) for (const [kind, look] of Object.entries(FOREST_LOOK)) forestK[kind] = FOREST.w / (FOREST_REPEAT * look.scale * shrink);
    // Both textures are partly see-through: only their opaque parts change the ground.
    function gameTexture(c, out, lx, ly, treeW, mask) {
      if (c === MOUNTAIN && MOUNT) {
        const s = texAt(MOUNT, mountK, lx, ly);
        const a = MOUNT.px[s + 3] / 255;
        const f = 1 - a * MOUNT_STREAKS * (1 - MOUNT.px[s] / 255);
        out[0] *= f; out[1] *= f; out[2] *= f;
      }
      if (treeW <= 0 || !FOREST || !mask) return;
      // Each kind drawn here is its own layer of trees, laid over the previous ones.
      const px = FOREST.px;
      for (const kind of KINDS_IN.tree[c * 256 + mask]) {
        const look = FOREST_LOOK[kind];
        const s = texAt(FOREST, forestK[kind], lx + look.shift, ly + look.shift);
        const a = px[s + 3] * treeW / 255;
        if (a <= 0) continue;
        const t = look.tint;
        out[0] += (Math.min(255, px[s] * t[0]) - out[0]) * a;
        out[1] += (Math.min(255, px[s + 1] * t[1]) - out[1]) * a;
        out[2] += (Math.min(255, px[s + 2] * t[2]) - out[2]) * a;
      }
    }

    // Color of class `c` at a distance (margin) from the border with class `other`.
    function colorOf(c, other, margin, noise, treeW, out, lx, ly) {
      if (c === 0) {
        if (other > 0 && margin < foamW) {
          out[0] = FOAM_RGB[0]; out[1] = FOAM_RGB[1]; out[2] = FOAM_RGB[2];
          out[3] = 190 * (1 - margin / foamW);
        } else out[3] = 0;
        return;
      }
      const rgb = margin < edgeW && other !== c ? EDGE_RGB[c] : BASE_RGB[c];
      let f = 1 + (noise - 0.5) * 0.07;
      if (treeW > 0 && TREE_MASK[c] && !FOREST) f *= 1 - 0.13 * treeW;
      if (c === LAVA && rgb === BASE_RGB[c]) {
        // Lava glows brighter in the middle of a flow, with slow swirls (in world cells).
        const swirl = 0.5 + 0.25 * Math.sin(lx * 0.9 + 2 * Math.sin(ly * 0.45)) + 0.25 * Math.sin(ly * 0.8 + 2 * Math.sin(lx * 0.35));
        const glow = Math.min(1, margin * 1.4) * (0.25 + 0.75 * swirl);
        out[0] = Math.min(255, rgb[0] * f + 13 * glow);
        out[1] = Math.min(255, rgb[1] * f + 120 * glow);
        out[2] = Math.min(255, rgb[2] * f + 20 * glow);
        out[3] = 255;
        return;
      }
      out[0] = Math.min(255, rgb[0] * f);
      out[1] = Math.min(255, rgb[1] * f);
      out[2] = Math.min(255, rgb[2] * f);
      out[3] = 255;
    }

    // Only the changed area when the tile was drawn before, else the whole tile.
    const part = t.bmp && t.dirtyRect;
    const px0 = part ? (part.x0 - tx * cpt) * u : 0, px1 = part ? (part.x1 + 1 - tx * cpt) * u : size;
    const py0 = part ? (part.y0 - ty * cpt) * u : 0, py1 = part ? (part.y1 + 1 - ty * cpt) * u : size;

    for (let py = py0; py < py1; py++) {
      const bj = rowB[py];
      const rw = py * 4;
      const nrow = ((gpy0 + py) & (NOISE_SIZE - 1)) * NOISE_SIZE;
      for (let px = px0; px < px1; px++) {
        const o = py * size + px;
        const bi = colB[px];
        const ub = bj * UW + bi;
        const c0 = uni[ub];
        if (c0 === 0) { pix[o] = 0; continue; }
        const nk = NOISE[nrow + ((gpx0 + px) & (NOISE_SIZE - 1))];

        // Fast path: plain land away from any border (in the game look, not forest or mountain).
        if (c0 !== 255 && c0 !== LAVA) {
          const tu = tuni[ub];
          if (tu !== 255 && !(GL && (tu === 1 || c0 === MOUNTAIN))) { pix[o] = PLAIN[(c0 * 2 + tu) * 8 + nk]; continue; }
        }
        // Tree kinds anywhere in the sample block, so forest edges fade smoothly with treeW.
        let mask = 0;
        if (GL) {
          for (let n = 0; n < 4; n++) {
            const row = (bj + n) * LW + bi;
            mask |= tm[row] | tm[row + 1] | tm[row + 2] | tm[row + 3];
          }
          // Fast path for the game look: forest or mountain away from any border.
          if (c0 !== 255 && c0 !== LAVA && tuni[ub] !== 255) {
            const p = PLAIN[c0 * 16 + nk];  // the ground, without the drawn-tree shade
            rgba[0] = p & 255; rgba[1] = (p >>> 8) & 255; rgba[2] = (p >>> 16) & 255;
            gameTexture(c0, rgba, (gpx0 + px) / u, (gpy0 + py) / u, tuni[ub], mask);
            pix[o] = pack(rgba[0] | 0, rgba[1] | 0, rgba[2] | 0);
            continue;
          }
        }

        const cw = px * 4;
        const noise = nk / 7;
        const lx = (gpx0 + px) / u, ly = (gpy0 + py) / u;
        let treeW = tuni[ub];
        if (treeW === 255) {
          treeW = 0;
          for (let n = 0; n < 4; n++) {
            const row = (bj + n) * LW + bi;
            const wy = rowW[rw + n];
            for (let m = 0; m < 4; m++) if (tb[row + m]) treeW += wy * colW[cw + m];
          }
        }

        if (c0 !== 255) {
          colorOf(c0, c0, 1, noise, treeW, rgba, lx, ly);
          if (GL && c0 !== LAVA) gameTexture(c0, rgba, lx, ly, treeW, mask);
          pix[o] = pack(rgba[0] | 0, rgba[1] | 0, rgba[2] | 0);
          continue;
        }

        // Mixed block: find the strongest and second strongest class.
        for (let n = 0; n < 4; n++) {
          const row = (bj + n) * LW + bi;
          const wy = rowW[rw + n];
          for (let m = 0; m < 4; m++) acc[cb[row + m]] += wy * colW[cw + m];
        }
        let best = 0, bw = -1, second = 0, sw = -1;
        for (let c = 0; c < NUM_CLASSES; c++) {
          const w = acc[c];
          if (w > bw) { second = best; sw = bw; best = c; bw = w; }
          else if (w > sw) { second = c; sw = w; }
          acc[c] = 0;
        }
        const margin = bw - Math.max(sw, 0);
        colorOf(best, second, margin, noise, treeW, rgba, lx, ly);
        if (margin < aaW && sw > 0) {
          // Anti-alias right at the border.
          colorOf(second, best, margin, noise, treeW, rgba2, lx, ly);
          const f = 0.5 - margin / (2 * aaW);
          for (let k = 0; k < 4; k++) rgba[k] += (rgba2[k] - rgba[k]) * f;
        }
        if (GL && best !== 0 && best !== LAVA) {
          // Tree bits mean different kinds in different biomes: only read the winning biome's cells.
          let bestMask = 0;
          for (let n = 0; n < 4; n++) {
            const row = (bj + n) * LW + bi;
            for (let m = 0; m < 4; m++) if (cb[row + m] === best) bestMask |= tm[row + m];
          }
          gameTexture(best, rgba, lx, ly, treeW, bestMask);
        }
        pix[o] = rgba[3] <= 0 ? 0 : pack(rgba[0] | 0, rgba[1] | 0, rgba[2] | 0, Math.min(255, rgba[3]) | 0);
      }
    }
    if (part) {
      // Start from the old picture and replace just the changed area (and its trees).
      surfCtx.clearRect(0, 0, size, size);
      surfCtx.drawImage(t.bmp, 0, 0);
      surfCtx.putImageData(surfImg, 0, 0, px0, py0, px1 - px0, py1 - py0);
      surfCtx.save();
      surfCtx.beginPath();
      surfCtx.rect(px0, py0, px1 - px0, py1 - py0);
      surfCtx.clip();
      drawTileDetails(surfCtx, u, cpt, tx, ty, !FOREST);
      surfCtx.restore();
    } else {
      surfCtx.putImageData(surfImg, 0, 0);
      drawTileDetails(surfCtx, u, cpt, tx, ty, !FOREST);
    }

    if (t.bmp && t.bmp.close) t.bmp.close();
    if (surf.transferToImageBitmap) {
      t.bmp = surf.transferToImageBitmap();
    } else {
      const copy = document.createElement('canvas');
      copy.width = copy.height = TILE_PX;
      copy.getContext('2d').drawImage(surf, 0, 0);
      t.bmp = copy;
    }
    t.dirty = false;
    t.dirtyRect = null;
  }

  // Draw the trees (unless the game look's forest texture shows them) and map symbols of a tile.
  // Spots sit on jittered grids in world cells, so neighboring tiles agree on every drawing.
  function drawTileDetails(g, u, cpt, tx, ty, withTrees) {
    const ox = tx * cpt, oy = ty * cpt;
    // Past DETAIL_PX pixels per cell, drawings and their spacing shrink (in cells) so they keep
    // the same small size on screen: zooming in shows more of them, not bigger ones.
    const shrink = Math.min(u, DETAIL_PX) / u;
    const reach = DETAIL_REACH * shrink + 1;
    const items = [];                       // [foot y, x, height in cells, kind, type]

    // Visit every spot of a grid with `spacing` cells whose drawing can reach this tile.
    const spots = (cellSpacing, salt, visit) => {
      const spacing = cellSpacing * shrink;
      const a0 = Math.floor((ox - reach) / spacing), a1 = Math.floor((ox + cpt + reach) / spacing);
      const b0 = Math.floor((oy - reach) / spacing), b1 = Math.floor((oy + cpt + reach) / spacing);
      for (let b = b0; b <= b1; b++) {
        for (let a = a0; a <= a1; a++) {
          const cx = (a + hash(a, b, salt + 2)) * spacing;
          const cy = (b + hash(a, b, salt + 3)) * spacing;
          const gx = Math.floor(cx), gy = Math.floor(cy);
          if (gx < 0 || gy < 0 || gx >= N || gy >= N) continue;
          const i = gy * N + gx;
          if (clsAt(i) !== grid[i]) continue;  // covered by lava, ice...
          visit(a, b, cx, cy, i);
        }
      }
    };

    // Trees: one grid; where several kinds were drawn, each spot picks one of them.
    if (withTrees) {
      spots(TREE_SPACING, 0, (a, b, cx, cy, i) => {
        const kinds = KINDS_IN.tree[grid[i] * 256 + detail[i]];
        if (!kinds.length) return;
        const kind = kinds.length === 1 ? kinds[0] : kinds[Math.floor(hash(a, b, 5) * kinds.length)];
        const look = TREE_LOOK[kind];
        if (hash(a, b, 1) > look.density) return;
        items.push([cy, cx, (2.6 + hash(a, b, 4) * 1.2) * look.size, kind, 'tree']);
      });
    }
    // Symbols: each kind has its own grid, so peaks spread out more than boulders.
    for (const [kind, look] of Object.entries(GLYPH_LOOK)) {
      spots(look.spacing, look.salt, (a, b, cx, cy, i) => {
        const bit = detailBit(grid[i], kind);
        if (!bit || !(detail[i] & bit) || hash(a, b, look.salt) > look.density) return;
        items.push([cy, cx, look.size[0] + hash(a, b, look.salt + 4) * (look.size[1] - look.size[0]), kind, 'glyph']);
      });
    }

    items.sort((p, q) => p[0] - q[0]);      // top to bottom so lower drawings overlap
    for (const [cy, cx, h, kind, type] of items) {
      const x = (cx - ox) * u, y = (cy - oy) * u;
      const px = h * shrink * u;
      const simple = px < 12;               // tiny drawings: plain shapes, no outlines
      if (type === 'tree') drawTree(g, kind, x, y, px, simple);
      else drawGlyph(g, kind, x, y, px, simple);
    }
  }

  // Map symbols, drawn like the trees. (x, y) is the foot of the drawing, h its height.
  function drawGlyph(g, kind, x, y, h, simple) {
    const line = (color, width) => {
      if (simple) return;
      g.lineWidth = Math.max(0.6, h * width);
      g.strokeStyle = color;
      g.stroke();
    };
    const poly = (pts, fill) => {
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (!simple) {
      g.fillStyle = 'rgba(0,0,0,.18)';
      g.beginPath();
      g.ellipse(x + h * 0.12, y, h * (kind === 'peak' || kind === 'hill' || kind === 'snowhill' ? 0.75 : 0.32), h * 0.08, 0, 0, Math.PI * 2);
      g.fill();
    }

    if (kind === 'peak') {
      // Snowy mountain: shaded rock with a lit left face and a snow cap.
      const w = h * 0.72;
      poly([[x - w, y], [x, y - h], [x + w, y]], '#8f989d');
      poly([[x - w, y], [x, y - h], [x - w * 0.12, y]], '#c4ccd1');
      poly([[x, y - h], [x + w * 0.36, y - h * 0.62], [x + w * 0.16, y - h * 0.55], [x, y - h * 0.64],
        [x - w * 0.18, y - h * 0.56], [x - w * 0.38, y - h * 0.6]], '#ffffff');
      g.beginPath(); g.moveTo(x - w, y); g.lineTo(x, y - h); g.lineTo(x + w, y);
      line('#3f474c', 0.035);
    } else if (kind === 'hill' || kind === 'snowhill') {
      const snow = kind === 'snowhill';
      const w = h * 1.25;
      g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y - h * 2, x + w, y); g.closePath();
      g.fillStyle = snow ? '#ffffff' : '#b5bcbf';
      g.fill();
      g.beginPath(); g.moveTo(x + w * 0.1, y - h * 0.98); g.quadraticCurveTo(x + w * 0.75, y - h * 0.7, x + w, y); g.lineTo(x + w * 0.2, y);
      g.closePath();
      g.fillStyle = snow ? '#d3e6f1' : '#959ea2';
      g.fill();
      g.beginPath(); g.moveTo(x - w, y); g.quadraticCurveTo(x, y - h * 2, x + w, y);
      line(snow ? '#7d9db0' : '#4f585c', 0.06);
    } else if (kind === 'boulders' || kind === 'rocks') {
      const moss = kind === 'boulders';
      if (moss) {
        g.beginPath(); g.ellipse(x + h * 0.35, y - h * 0.3, h * 0.45, h * 0.32, 0, 0, Math.PI * 2);
        g.fillStyle = '#6f7468'; g.fill(); line('#2f332b', 0.06);
        g.beginPath(); g.ellipse(x - h * 0.1, y - h * 0.45, h * 0.62, h * 0.48, 0, 0, Math.PI * 2);
        g.fillStyle = '#80867a'; g.fill(); line('#2f332b', 0.06);
        g.beginPath(); g.ellipse(x - h * 0.2, y - h * 0.78, h * 0.42, h * 0.18, 0, 0, Math.PI * 2);
        g.fillStyle = '#5f8a3e'; g.fill();
      } else {
        const w = h * 0.55;
        const pts = [[x - w, y], [x - w * 0.85, y - h * 0.7], [x - w * 0.2, y - h], [x + w * 0.6, y - h * 0.82], [x + w, y]];
        poly(pts, '#ab9c7c');
        poly([[x + w * 0.05, y - h * 0.9], [x + w * 0.6, y - h * 0.82], [x + w, y], [x + w * 0.1, y]], '#8b7e62');
        g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath();
        line('#4f4636', 0.05);
      }
    } else if (kind === 'cliff') {
      // Craggy Mistlands rock spire.
      const w = h * 0.4;
      const pts = [[x - w, y], [x - w * 0.55, y - h * 0.5], [x - w * 0.3, y - h * 0.46], [x - w * 0.05, y - h],
        [x + w * 0.3, y - h * 0.62], [x + w * 0.55, y - h * 0.66], [x + w, y]];
      poly(pts, '#58516d');
      poly([[x - w, y], [x - w * 0.55, y - h * 0.5], [x - w * 0.3, y - h * 0.46], [x - w * 0.05, y - h], [x - w * 0.1, y]], '#7b7394');
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts.slice(1)) g.lineTo(p[0], p[1]); g.closePath();
      line('#25202f', 0.03);
    } else if (kind === 'shoot') {
      // Yggdrasil shoot: tall pale trunk with a blue-green glowing crown.
      trunk(g, x, y, h * 0.08, h * 0.78, '#7a6a80', simple ? 0 : Math.max(0.6, h * 0.04));
      crown(g, [[x, y - h * 0.82, h * 0.17], [x - h * 0.15, y - h * 0.7, h * 0.13], [x + h * 0.15, y - h * 0.72, h * 0.13]],
        '#7fb9ad', '#2f514b', '#b8e3da', simple ? 0 : Math.max(0.6, h * 0.04));
    } else {
      // Dead swamp tree, or a charred Ashlands tree with glowing embers.
      const ash = kind === 'ashwood';
      g.strokeStyle = ash ? '#1b1411' : '#3a3024';
      g.lineWidth = Math.max(1, h * 0.09);
      g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x - h * 0.06, y - h * 0.5, x + h * 0.03, y - h * 0.82); g.stroke();
      g.lineWidth = Math.max(0.7, h * 0.045);
      const twigs = [[x - h * 0.01, y - h * 0.5, x - h * 0.3, y - h * 0.82], [x + h * 0.02, y - h * 0.62, x + h * 0.3, y - h * 0.92],
        [x + h * 0.03, y - h * 0.8, x - h * 0.08, y - h], [x, y - h * 0.08, x - h * 0.16, y + h * 0.02], [x, y - h * 0.08, x + h * 0.15, y + h * 0.03]];
      g.beginPath();
      for (const [x1, y1, x2, y2] of twigs) { g.moveTo(x1, y1); g.lineTo(x2, y2); }
      g.stroke();
      if (ash) {
        g.fillStyle = '#ff7a2a';
        for (const [, , x2, y2] of twigs.slice(0, 3)) { g.beginPath(); g.arc(x2, y2, Math.max(0.8, h * 0.035), 0, Math.PI * 2); g.fill(); }
      } else if (!simple) {
        g.fillStyle = 'rgba(70,82,48,.75)';   // hanging moss
        g.beginPath(); g.ellipse(x - h * 0.2, y - h * 0.74, h * 0.1, h * 0.05, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(x + h * 0.2, y - h * 0.82, h * 0.09, h * 0.05, 0, 0, Math.PI * 2); g.fill();
      }
    }
  }

  // Trees are drawn side-on like a hand-drawn map. (x, y) is the foot of the trunk, h the height.
  function drawTree(g, kind, x, y, h, simple) {
    if (simple) {
      g.beginPath();
      if (kind === 'fir' || kind === 'snowfir') {
        g.moveTo(x, y - h);
        g.lineTo(x + h * 0.3, y);
        g.lineTo(x - h * 0.3, y);
        g.fillStyle = kind === 'fir' ? '#4f7f45' : '#2f5852';
      } else if (kind === 'pine') {
        g.arc(x, y - h * 0.8, h * 0.18, 0, Math.PI * 2);
        g.fillStyle = '#5a8a3e';
      } else if (kind === 'birch') {
        g.arc(x, y - h * 0.68, h * 0.2, 0, Math.PI * 2);
        g.fillStyle = '#d9b13a';
      } else if (kind === 'oak') {
        g.arc(x, y - h * 0.6, h * 0.36, 0, Math.PI * 2);
        g.fillStyle = '#3f7a2a';
      } else {
        g.arc(x, y - h * 0.6, h * 0.3, 0, Math.PI * 2);
        g.fillStyle = '#5c9a35';
      }
      g.fill();
      return;
    }

    g.lineJoin = 'round';
    const lw = Math.max(0.6, h * 0.045);
    g.fillStyle = 'rgba(0,0,0,.2)';
    g.beginPath();
    g.ellipse(x + h * 0.1, y, h * 0.3, h * 0.09, 0, 0, Math.PI * 2);
    g.fill();

    if (kind === 'beech') {
      trunk(g, x, y, h * 0.1, h * 0.5, '#7a6a58', lw);
      crown(g, [[x, y - h * 0.66, h * 0.3], [x - h * 0.2, y - h * 0.52, h * 0.22], [x + h * 0.21, y - h * 0.54, h * 0.22]],
        '#5c9a35', '#2a4f1a', '#7cbc4c', lw);
    } else if (kind === 'oak') {
      trunk(g, x, y, h * 0.15, h * 0.45, '#5a3c22', lw);
      crown(g, [[x, y - h * 0.68, h * 0.28], [x - h * 0.28, y - h * 0.55, h * 0.24], [x + h * 0.28, y - h * 0.56, h * 0.24],
        [x - h * 0.12, y - h * 0.45, h * 0.22], [x + h * 0.14, y - h * 0.46, h * 0.2]], '#3f7a2a', '#1d3a12', '#5c9a3a', lw);
    } else if (kind === 'birch') {
      // Slender white trunk with dark marks and a golden crown.
      const tw = h * 0.07, tl = h * 0.72;
      trunk(g, x, y, tw, tl, '#ece6d6', lw);
      g.fillStyle = '#2a2a2a';
      for (let k = 1; k <= 3; k++) g.fillRect(x - tw / 2, y - (tl * k) / 4, tw * 0.6, Math.max(0.6, h * 0.025));
      crown(g, [[x, y - h * 0.74, h * 0.2], [x - h * 0.13, y - h * 0.6, h * 0.15], [x + h * 0.13, y - h * 0.62, h * 0.15]],
        '#d9b13a', '#6e5212', '#f0d470', lw);
    } else if (kind === 'pine') {
      // Tall bare red-brown trunk with a small crown up top.
      trunk(g, x, y, h * 0.07, h * 0.85, '#9a5a32', lw);
      crown(g, [[x, y - h * 0.86, h * 0.15], [x - h * 0.14, y - h * 0.74, h * 0.13], [x + h * 0.15, y - h * 0.77, h * 0.13],
        [x + h * 0.02, y - h * 0.66, h * 0.11]], '#2f5a2a', '#132812', '#4a7a3a', lw);
    } else {
      const snow = kind === 'snowfir';
      trunk(g, x, y, h * 0.08, h * 0.18, '#4a3220', lw);
      g.lineWidth = lw;
      for (let k = 3; k >= 0; k--) {
        const w = h * (0.12 + k * 0.065);
        const top = y - h + k * h * 0.19;
        const bot = top + h * 0.34;
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x + w, bot);
        g.lineTo(x - w, bot);
        g.closePath();
        g.fillStyle = snow ? '#2f5852' : '#2f5a3a';
        g.fill();
        g.strokeStyle = snow ? '#13292a' : '#13261a';
        g.stroke();
        if (snow) {
          g.beginPath();
          g.moveTo(x, top);
          g.lineTo(x + w * 0.5, top + h * 0.17);
          g.lineTo(x - w * 0.5, top + h * 0.17);
          g.closePath();
          g.fillStyle = '#f4fbff';
          g.fill();
        }
      }
    }
  }

  // lw = 0 draws without outlines.
  function trunk(g, x, y, w, len, color, lw) {
    g.beginPath();
    g.rect(x - w / 2, y - len, w, len);
    g.fillStyle = color;
    g.fill();
    if (!lw) return;
    g.lineWidth = lw * 0.8;
    g.strokeStyle = 'rgba(0,0,0,.45)';
    g.stroke();
  }

  // A leafy crown of overlapping circles: outline first, then fill on top, then a highlight.
  function crown(g, circles, fill, line, light, lw) {
    g.beginPath();
    for (const [cx, cy, r] of circles) {
      g.moveTo(cx + r, cy);
      g.arc(cx, cy, r, 0, Math.PI * 2);
    }
    if (lw) {
      g.lineWidth = lw * 2;
      g.strokeStyle = line;
      g.stroke();
    }
    g.fillStyle = fill;
    g.fill();
    const [cx, cy, r] = circles[0];
    g.beginPath();
    g.arc(cx - r * 0.3, cy - r * 0.3, r * 0.45, 0, Math.PI * 2);
    g.fillStyle = light;
    g.fill();
  }

  // Draw the visible tiles for the main view, rendering missing ones within a time budget.
  // While a tile is missing, a coarser or finer cached tile of the same area stands in.
  function drawTiles(c, cam) {
    const cellDev = CELL * cam.s * DPR;
    if (cellDev < TILE_MIN_CELL_PX) return;
    const u = Math.min(16, Math.max(2, 2 ** Math.ceil(Math.log2(cellDev))));
    const cpt = tileCells(u);
    const count = N / cpt;
    frameNo++;

    // Draw a square of a tile image onto the square of cells it shows.
    // Both edges are rounded the same way for every tile so neighbors meet without seams.
    const blit = (src, sx, sy, sw, cellX, cellY, cells) => {
      const [ax, ay] = w2s(cam, cellX * CELL - HALF, HALF - cellY * CELL);
      const [bx, by] = w2s(cam, (cellX + cells) * CELL - HALF, HALF - (cellY + cells) * CELL);
      const dx = Math.round(ax * DPR) / DPR, dy = Math.round(ay * DPR) / DPR;
      c.drawImage(src, sx, sy, sw, sw, dx, dy, Math.round(bx * DPR) / DPR - dx, Math.round(by * DPR) / DPR - dy);
    };
    const ready = (uu, x, y) => {
      const t = tileCache.get(tileKey(uu, x, y));
      if (!t || !t.bmp || t.dirty) return null;
      t.used = frameNo;
      return t;
    };
    const standIn = (tx, ty) => {
      for (let pu = u / 2; pu >= 2; pu /= 2) {
        const pc = tileCells(pu);
        const ptx = Math.floor((tx * cpt) / pc), pty = Math.floor((ty * cpt) / pc);
        const p = ready(pu, ptx, pty);
        if (p) {
          blit(p.bmp, (tx * cpt - ptx * pc) * pu, (ty * cpt - pty * pc) * pu, cpt * pu, tx * cpt, ty * cpt, cpt);
          return;
        }
      }
      if (u < 16) {
        const half = cpt / 2;
        for (let j = 0; j < 2; j++) {
          for (let i = 0; i < 2; i++) {
            const ch = ready(u * 2, tx * 2 + i, ty * 2 + j);
            if (ch) blit(ch.bmp, 0, 0, TILE_PX, (tx * 2 + i) * half, (ty * 2 + j) * half, half);
          }
        }
      }
    };

    const [wx0, wz1] = s2w(0, 0);
    const [wx1, wz0] = s2w(W, H);
    const tx0 = Math.max(0, Math.floor((wx0 + HALF) / CELL / cpt));
    const tx1 = Math.min(count - 1, Math.floor((wx1 + HALF) / CELL / cpt));
    const ty0 = Math.max(0, Math.floor((HALF - wz1) / CELL / cpt));
    const ty1 = Math.min(count - 1, Math.floor((HALF - wz0) / CELL / cpt));
    const tileM = cpt * CELL;
    const visible = [];
    const todo = [];

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // Skip tiles completely outside the round world.
        const mx0 = tx * tileM - HALF, mz1 = HALF - ty * tileM;
        const nx = Math.max(mx0, Math.min(0, mx0 + tileM));
        const nz = Math.max(mz1 - tileM, Math.min(0, mz1));
        if (nx * nx + nz * nz > WORLD_R * WORLD_R) continue;
        const key = tileKey(u, tx, ty);
        let t = tileCache.get(key);
        if (!t) { t = { u, tx, ty, bmp: null, dirty: true, dirtySince: performance.now(), used: 0 }; tileCache.set(key, t); }
        t.used = frameNo;
        visible.push(t);
        if (t.dirty || !t.bmp) todo.push(t);
      }
    }

    if (todo.length) {
      // Nearest first (to the brush while painting, else to the middle of the screen), but the
      // longer a tile has waited the sooner it comes, so no tile is left behind while painting.
      const [fx, fy] = hover ? [hover.x, hover.y] : [W / 2, H / 2];
      const now = performance.now();
      const order = t => {
        const [sx, sy] = w2s(cam, (t.tx + 0.5) * tileM - HALF, HALF - (t.ty + 0.5) * tileM);
        return Math.hypot(sx - fx, sy - fy) - (now - (t.dirtySince || now)) * 4;
      };
      todo.sort((a, b) => order(a) - order(b));
      const start = performance.now();
      let n = 0;
      for (const t of todo) {
        if (n > 0 && performance.now() - start > TILE_BUDGET_MS) { requestDraw(); break; }
        renderTile(t);
        n++;
      }
    }

    // Draw each tile once. A tile still waiting to be redrawn shows its old picture, so nothing
    // flickers; one never drawn yet shows a coarser or finer tile of the same area.
    for (const t of visible) {
      if (t.bmp) blit(t.bmp, 0, 0, TILE_PX, t.tx * cpt, t.ty * cpt, cpt);
      else standIn(t.tx, t.ty);
    }

    if (tileCache.size > MAX_TILES) {
      const old = [...tileCache.entries()].filter(([, t]) => t.used !== frameNo).sort((a, b) => a[1].used - b[1].used);
      for (const [key, t] of old) {
        if (tileCache.size <= MAX_TILES * 0.8) break;
        dropTile(key, t);
      }
    }
  }

  // ---------- DOM ----------
  const $ = sel => document.querySelector(sel);
  const stage = $('#stage');
  const canvas = $('#map');
  const ctx = canvas.getContext('2d');
  const popup = $('#popup');
  const popupLabel = $('#popupLabel');
  let W = 0, H = 0, DPR = 1;

  function svgIcon(id) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 512 512');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', ICONS[id]);
    svg.appendChild(p);
    return svg;
  }

  const pathCache = {};
  const iconPath = id => pathCache[id] || (pathCache[id] = new Path2D(ICONS[id]));

  // ---------- Camera ----------
  const mainCam = () => ({ x: view.x, z: view.z, s: view.s, w: W, h: H });
  const w2s = (cam, x, z) => [cam.w / 2 + (x - cam.x) * cam.s, cam.h / 2 - (z - cam.z) * cam.s];
  const s2w = (px, py) => [view.x + (px - W / 2) / view.s, view.z - (py - H / 2) / view.s];

  const fitScale = () => (Math.min(W, H) * 0.46) / WORLD_R;
  function clampView() {
    const min = fitScale() * 0.6;
    view.s = Math.max(min, Math.min(MAX_ZOOM, view.s));
    const d = Math.hypot(view.x, view.z);
    const max = WORLD_R * 1.05;
    if (d > max) { view.x *= max / d; view.z *= max / d; }
  }
  function fitView() {
    view.x = 0; view.z = 0; view.s = fitScale();
    requestDraw();
  }
  function zoomAt(px, py, factor) {
    const [wx, wz] = s2w(px, py);
    view.s *= factor;
    clampView();
    view.x = wx - (px - W / 2) / view.s;
    view.z = wz + (py - H / 2) / view.s;
    clampView();
    requestDraw();
  }

  function resize() {
    const first = W === 0;
    DPR = window.devicePixelRatio || 1;
    W = stage.clientWidth;
    H = stage.clientHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    if (first && !restoredView) fitView();
    clampView();
    requestDraw();
  }

  // ---------- Rendering ----------
  let drawQueued = false;
  function requestDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  // The game picture for a place (or 'spawn'), when the game look is on.
  const artFor = key => (gameLook && gameImg[CATALOG.gameArt[key]]) || null;

  // Fill the round world with a repeating game texture that stays fixed to the map when panning.
  const patternCache = new WeakMap();
  function fillWorldTexture(c, cam, name, metersPerRepeat, blend, alpha, R) {
    const img = gameImg[name];
    if (!img) return;
    let pats = patternCache.get(c);
    if (!pats) patternCache.set(c, (pats = {}));
    const pat = pats[name] || (pats[name] = c.createPattern(img, 'repeat'));
    const [ox, oy] = w2s(cam, -HALF, HALF);
    const k = (metersPerRepeat * cam.s) / img.width;
    pat.setTransform(new DOMMatrix([k, 0, 0, k, ox, oy]));
    const [cx, cy] = w2s(cam, 0, 0);
    c.save();
    c.globalCompositeOperation = blend;
    c.globalAlpha = alpha;
    c.fillStyle = pat;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  // A round marker: colored disc with a white symbol, or a dark disc with a game picture (`img`).
  function drawBadge(c, x, y, iconId, fill, ring, r, img) {
    c.save();
    c.translate(x, y);
    c.shadowColor = 'rgba(0,0,0,.55)';
    c.shadowBlur = r * 0.35;
    c.shadowOffsetY = r * 0.1;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = img && r >= DOT_R ? GAME_BADGE : fill;
    c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = r < DOT_R ? Math.max(0.8, r * 0.3) : Math.max(1.5, r * 0.16);
    c.strokeStyle = ring;
    c.stroke();
    if (r < DOT_R) { c.restore(); return; }
    if (img) {
      const s = (r * 1.55) / Math.max(img.width, img.height);
      c.drawImage(img, (-img.width * s) / 2, (-img.height * s) / 2, img.width * s, img.height * s);
      c.restore();
      return;
    }
    const k = (r * 1.3) / 512;
    c.scale(k, k);
    c.translate(-256, -256);
    c.fillStyle = '#fff';
    c.fill(iconPath(iconId));
    c.restore();
  }

  function drawLabel(c, text, x, y, size) {
    c.font = `700 ${size}px "Segoe UI", system-ui, sans-serif`;
    c.textAlign = 'center';
    c.textBaseline = 'top';
    c.lineJoin = 'round';
    c.lineWidth = size * 0.32;
    c.strokeStyle = 'rgba(20,14,10,.9)';
    c.strokeText(text, x, y);
    c.fillStyle = '#fff';
    c.fillText(text, x, y);
  }

  // Draws the round world, biomes, rings, spawn and markers for a camera.
  // `k` scales markers, `ui` scales rings and the north arrow.
  function renderWorld(c, cam, { k = 1, ui = 1, allLabels = false, tiles = false } = {}) {
    const [cx, cy] = w2s(cam, 0, 0);
    const R = WORLD_R * cam.s;

    // Frame and shadow
    c.save();
    c.shadowColor = 'rgba(0,0,0,.6)';
    c.shadowBlur = 30 * ui;
    c.beginPath();
    c.arc(cx, cy, R + 8 * ui, 0, Math.PI * 2);
    c.fillStyle = '#5a4532';
    c.fill();
    c.restore();

    // Water
    const water = c.createRadialGradient(cx, cy, 0, cx, cy, R);
    water.addColorStop(0, '#4f86ab');
    water.addColorStop(1, '#2a5574');
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fillStyle = water;
    c.fill();
    if (gameLook) fillWorldTexture(c, cam, 'water', WATER_REPEAT_M, 'source-over', 0.16, R);

    // Land: the overview image, then sharp tiles on top when zoomed in.
    c.save();
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.clip();
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    const [lx, ty] = w2s(cam, -HALF, HALF);
    c.drawImage(bioCanvas, lx, ty, N * CELL * cam.s, N * CELL * cam.s);
    if (tiles) drawTiles(c, cam);
    // The game's parchment mottling over everything.
    if (gameLook) fillWorldTexture(c, cam, 'background', PAPER_REPEAT_M, 'soft-light', 0.5, R);

    // Distance rings from spawn
    if (showRings) {
      c.setLineDash([8 * ui, 8 * ui]);
      c.lineWidth = 1.5 * ui;
      c.strokeStyle = 'rgba(255,255,255,.3)';
      for (let r = 2000; r < WORLD_R; r += 2000) {
        c.beginPath();
        c.arc(cx, cy, r * cam.s, 0, Math.PI * 2);
        c.stroke();
      }
      c.setLineDash([]);
      c.font = `600 ${12 * ui}px "Segoe UI", sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = 'rgba(255,255,255,.65)';
      for (let r = 2000; r < WORLD_R; r += 2000) c.fillText(`${r / 1000} km`, cx, cy - r * cam.s);
    }
    c.restore();

    // Rim
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.lineWidth = 3 * ui;
    c.strokeStyle = 'rgba(242,193,78,.55)';
    c.stroke();

    // North marker
    c.font = `800 ${18 * ui}px Georgia, serif`;
    c.textAlign = 'center';
    c.textBaseline = 'bottom';
    c.fillStyle = GOLD;
    c.fillText('N', cx, cy - R - 12 * ui);
    c.beginPath();
    c.moveTo(cx, cy - R - 2 * ui);
    c.lineTo(cx - 6 * ui, cy - R - 11 * ui);
    c.lineTo(cx + 6 * ui, cy - R - 11 * ui);
    c.closePath();
    c.fill();

    const labelSize = 13 * Math.max(0.75, k);
    const showDefault = allLabels || k >= LABEL_K;
    const showCustom = allLabels || k >= CUSTOM_LABEL_K;

    // Spawn
    drawBadge(c, cx, cy, CATALOG.ui.spawn, '#2b2118', GOLD, 18 * k, artFor('spawn'));
    if (showDefault) drawLabel(c, 'Spawn', cx, cy + 22 * k, labelSize);

    // Markers
    if (!showPlaces) return;
    for (const m of markers) {
      const def = placeByKey[m.type];
      const [sx, sy] = w2s(cam, m.x, m.z);
      const r = placeRadius(def) * k;
      if (sx < -r * 4 || sy < -r * 4 || sx > cam.w + r * 4 || sy > cam.h + r * 4) continue;
      if (m.id === selectedId && tiles) {
        c.beginPath();
        c.arc(sx, sy, r + 7, 0, Math.PI * 2);
        c.fillStyle = 'rgba(242,193,78,.45)';
        c.fill();
      }
      drawBadge(c, sx, sy, def.icon, placeBadge(def), def.boss ? GOLD : '#fff', r, artFor(m.type));
      const text = (showCustom && m.label) || (showDefault ? def.label : '');
      if (text) drawLabel(c, text, sx, sy + r + 4 * Math.max(0.5, k), labelSize);
    }
  }

  function brushColor() {
    if (layer === 'land') return biomeById[biome].color;
    const d = DETAILS[layer];
    return d.type === 'area' ? d.color : d.type === 'tree' ? '#2b4a24' : '#ffffff';
  }

  function drawBrushRing(r, filled) {
    ctx.beginPath();
    ctx.arc(hover.x, hover.y, Math.max(r, 3), 0, Math.PI * 2);
    if (filled) {
      ctx.fillStyle = brushColor() + '55';
      ctx.fill();
    }
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.6)';
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  }

  function draw() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#1b140f';
    ctx.fillRect(0, 0, W, H);
    const k = markerK(view.s);
    renderWorld(ctx, mainCam(), { k, tiles: true });

    if (hover && !drag) {
      if (placing) {
        const def = placeByKey[placing];
        ctx.globalAlpha = 0.75;
        drawBadge(ctx, hover.x, hover.y, def.icon, placeBadge(def), def.boss ? GOLD : '#fff', placeRadius(def) * k, artFor(placing));
        ctx.globalAlpha = 1;
      } else if (tool === 'brush' && !spaceDown && !hoverMarker) {
        drawBrushRing(SIZES[sizeIdx].m * view.s, true);
      }
    }
    if (drag?.kind === 'paint') drawBrushRing(SIZES[sizeIdx].m * view.s, false);
    positionPopup();
  }

  // ---------- Painting ----------
  const cellOf = (wx, wz) => [Math.floor((wx + HALF) / CELL), Math.floor((HALF - wz) / CELL)];
  const newBounds = () => ({ x0: N, y0: N, x1: -1, y1: -1 });
  // Set when a brush or fill changes cells that have (or get) trees or symbols drawn on them,
  // so the redraw covers how far those drawings reach.
  let touchedDrawn = false;

  // What the brush does to one cell, for the current biome and layer.
  // Details are added on top of what is there; painting land or water clears them.
  function brushApply() {
    if (layer !== 'land') {
      const d = detailBit(biome, layer);
      const drawn = drawnMask(biome);
      return i => {
        if (grid[i] !== biome) return;
        if ((d | detail[i]) & drawn) touchedDrawn = true;
        detail[i] |= d;
      };
    }
    return i => {
      if (detail[i] & drawnMask(grid[i])) touchedDrawn = true;
      grid[i] = biome;
      detail[i] = D_NONE;
    };
  }

  function stamp(wx, wz, radiusM, apply, b) {
    const [gx, gy] = cellOf(wx, wz);
    const r = Math.max(radiusM / CELL, 0.75);
    const ri = Math.ceil(r);
    const r2 = r * r;
    const ylo = Math.max(0, gy - ri), yhi = Math.min(N - 1, gy + ri);
    const xlo = Math.max(0, gx - ri), xhi = Math.min(N - 1, gx + ri);
    if (ylo > yhi || xlo > xhi) return;
    for (let y = ylo; y <= yhi; y++) {
      const dy = y - gy;
      for (let x = xlo; x <= xhi; x++) {
        const dx = x - gx;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * N + x;
        if (inWorld[i]) apply(i);
      }
    }
    b.x0 = Math.min(b.x0, xlo); b.y0 = Math.min(b.y0, ylo);
    b.x1 = Math.max(b.x1, xhi); b.y1 = Math.max(b.y1, yhi);
  }

  function startStroke(wx, wz) {
    drag = {
      kind: 'paint', apply: brushApply(),
      before: grid.slice(), beforeD: detail.slice(), b: newBounds(), last: [wx, wz],
    };
    paintSegment(wx, wz, wx, wz);
  }

  function paintSegment(ax, az, bx, bz) {
    const radius = SIZES[sizeIdx].m;
    const seg = newBounds();
    const dist = Math.hypot(bx - ax, bz - az);
    const step = Math.max(CELL, radius * 0.35);
    const n = Math.max(1, Math.ceil(dist / step));
    touchedDrawn = false;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      stamp(ax + (bx - ax) * t, az + (bz - az) * t, radius, drag.apply, seg);
    }
    if (seg.x1 < 0) return;
    const b = drag.b;
    b.x0 = Math.min(b.x0, seg.x0); b.y0 = Math.min(b.y0, seg.y0);
    b.x1 = Math.max(b.x1, seg.x1); b.y1 = Math.max(b.y1, seg.y1);
    redrawCells(seg.x0, seg.y0, seg.x1, seg.y1, touchedDrawn);
    requestDraw();
  }

  function paintTo(wx, wz) {
    const [ax, az] = drag.last;
    paintSegment(ax, az, wx, wz);
    drag.last = [wx, wz];
  }

  function commitCells(beforeG, beforeD, b) {
    if (b.x1 < 0) return;
    const rect = { x0: b.x0, y0: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 };
    const prevG = cut(beforeG, rect), nextG = cut(grid, rect);
    const prevD = cut(beforeD, rect), nextD = cut(detail, rect);
    let changed = false;
    for (let i = 0; i < prevG.length && !changed; i++) {
      if (prevG[i] !== nextG[i] || prevD[i] !== nextD[i]) changed = true;
    }
    if (!changed) return;
    pushUndo({ type: 'cells', rect, before: [prevG, prevD], after: [nextG, nextD] });
    markDirty();
  }

  function cut(src, { x0, y0, w, h }) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(src.subarray((y0 + y) * N + x0, (y0 + y) * N + x0 + w), y * w);
    return out;
  }

  function paste(dst, data, { x0, y0, w, h }) {
    for (let y = 0; y < h; y++) dst.set(data.subarray(y * w, y * w + w), (y0 + y) * N + x0);
  }

  // ---------- Undo ----------
  const undoStack = [];
  const redoStack = [];

  function pushUndo(entry) {
    undoStack.push(entry);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateUndoButtons();
  }

  function applyEntry(e, which) {
    if (e.type === 'cells') {
      const { x0, y0, w, h } = e.rect;
      paste(grid, e[which][0], e.rect);
      paste(detail, e[which][1], e.rect);
      redrawCells(x0, y0, x0 + w - 1, y0 + h - 1);
    } else {
      markers = JSON.parse(e[which]);
      if (!markers.some(m => m.id === selectedId)) selectMarker(null);
      else popupLabel.value = markers.find(m => m.id === selectedId).label || '';
    }
    markDirty();
    requestDraw();
  }

  function undo() {
    const e = undoStack.pop();
    if (!e) return;
    applyEntry(e, 'before');
    redoStack.push(e);
    updateUndoButtons();
  }

  function redo() {
    const e = redoStack.pop();
    if (!e) return;
    applyEntry(e, 'after');
    undoStack.push(e);
    updateUndoButtons();
  }

  function updateUndoButtons() {
    $('#undoBtn').disabled = !undoStack.length;
    $('#redoBtn').disabled = !redoStack.length;
  }

  function changeMarkers(fn) {
    const before = JSON.stringify(markers);
    fn();
    const after = JSON.stringify(markers);
    if (before !== after) pushUndo({ type: 'markers', before, after });
    markDirty();
    requestDraw();
  }

  // ---------- Markers ----------
  const screenRadius = def => placeRadius(def) * markerK(view.s);

  function hitMarker(px, py) {
    if (!showPlaces) return null;
    const cam = mainCam();
    for (let i = markers.length - 1; i >= 0; i--) {
      const m = markers[i];
      const [sx, sy] = w2s(cam, m.x, m.z);
      if (Math.hypot(px - sx, py - sy) <= Math.max(10, screenRadius(placeByKey[m.type]) + 4)) return m;
    }
    return null;
  }

  function placeMarker(wx, wz) {
    if (Math.hypot(wx, wz) > WORLD_R) { toast('Put it inside the round world!'); return; }
    const def = placeByKey[placing];
    changeMarkers(() => markers.push({ id: nextId++, type: placing, x: Math.round(wx), z: Math.round(wz), label: '' }));
    toast(`${def.label} added!`);
    setPlacing(null);
  }

  function selectMarker(id) {
    selectedId = id;
    popup.hidden = id === null;
    if (id !== null) {
      popupLabel.value = markers.find(m => m.id === id)?.label || '';
      positionPopup();
    }
    requestDraw();
  }

  function positionPopup() {
    if (selectedId === null) return;
    const m = markers.find(mm => mm.id === selectedId);
    if (!m) return;
    const [sx, sy] = w2s(mainCam(), m.x, m.z);
    const r = screenRadius(placeByKey[m.type]);
    let top = sy + r + 26;
    if (top + 60 > H) top = sy - r - 64;
    popup.style.left = `${Math.max(130, Math.min(W - 130, sx))}px`;
    popup.style.top = `${top}px`;
  }

  function deleteSelected() {
    if (selectedId === null) return;
    const id = selectedId;
    changeMarkers(() => { markers = markers.filter(m => m.id !== id); });
    selectMarker(null);
  }

  // ---------- Input ----------
  const pointers = new Map();
  let drag = null;          // { kind: 'paint' | 'pan' | 'marker' | 'pinch', ... }
  let hover = null;         // { x, y } in screen px
  let hoverMarker = null;
  let spaceDown = false;

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function startPan(px, py) {
    drag = { kind: 'pan', px, py, vx: view.x, vz: view.z };
    updateCursor();
  }

  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
  }

  function endDrag() {
    if (!drag) return;
    if (drag.kind === 'paint') commitCells(drag.before, drag.beforeD, drag.b);
    if (drag.kind === 'marker') {
      if (drag.moved) {
        const after = JSON.stringify(markers);
        if (after !== drag.before) pushUndo({ type: 'markers', before: drag.before, after });
        markDirty();
      } else {
        selectMarker(drag.id);
      }
    }
    drag = null;
    updateCursor();
    requestDraw();
  }

  canvas.addEventListener('pointerdown', e => {
    const [px, py] = local(e);
    try { canvas.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.set(e.pointerId, { x: px, y: py });
    hover = { x: px, y: py };

    if (pointers.size === 2) {
      endDrag();
      const p = pinchInfo();
      const [wx, wz] = s2w(p.cx, p.cy);
      drag = { kind: 'pinch', d: p.d, s: view.s, wx, wz };
      return;
    }
    if (pointers.size > 2) return;

    if (e.button === 1 || e.button === 2) { startPan(px, py); return; }
    if (e.button !== 0) return;

    const [wx, wz] = s2w(px, py);
    if (placing) { placeMarker(wx, wz); return; }
    if (spaceDown) { startPan(px, py); return; }

    const m = hitMarker(px, py);
    if (m) {
      const [sx, sy] = w2s(mainCam(), m.x, m.z);
      drag = { kind: 'marker', id: m.id, before: JSON.stringify(markers), px, py, ox: sx - px, oy: sy - py, moved: false };
      updateCursor();
      return;
    }
    selectMarker(null);

    if (tool === 'move') startPan(px, py);
    else startStroke(wx, wz);
  });

  canvas.addEventListener('pointermove', e => {
    const [px, py] = local(e);
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: px, y: py });
    hover = { x: px, y: py };

    if (!drag) {
      const hm = hitMarker(px, py);
      if (hm !== hoverMarker) { hoverMarker = hm; updateCursor(); }
      requestDraw();
      return;
    }

    if (drag.kind === 'pinch' && pointers.size === 2) {
      const p = pinchInfo();
      view.s = drag.s * (p.d / drag.d);
      clampView();
      view.x = drag.wx - (p.cx - W / 2) / view.s;
      view.z = drag.wz + (p.cy - H / 2) / view.s;
      clampView();
    } else if (drag.kind === 'pan') {
      view.x = drag.vx - (px - drag.px) / view.s;
      view.z = drag.vz + (py - drag.py) / view.s;
      clampView();
    } else if (drag.kind === 'paint') {
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) {
        const [cx, cy] = local(ev);
        paintTo(...s2w(cx, cy));
      }
    } else if (drag.kind === 'marker') {
      if (!drag.moved && Math.hypot(px - drag.px, py - drag.py) > 4) drag.moved = true;
      if (drag.moved) {
        const m = markers.find(mm => mm.id === drag.id);
        let [wx, wz] = s2w(px + drag.ox, py + drag.oy);
        const d = Math.hypot(wx, wz);
        if (d > WORLD_R) { wx *= WORLD_R / d; wz *= WORLD_R / d; }
        m.x = Math.round(wx);
        m.z = Math.round(wz);
      }
    }
    requestDraw();
  });

  function pointerEnd(e) {
    pointers.delete(e.pointerId);
    if (drag?.kind === 'pinch') {
      if (pointers.size < 2) drag = null;
      return;
    }
    endDrag();
  }
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', () => { if (!drag) { hover = null; requestDraw(); } });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const [px, py] = local(e);
    zoomAt(px, py, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  function updateCursor() {
    let c = 'none';
    if (drag?.kind === 'pan' || drag?.kind === 'marker') c = 'grabbing';
    else if (placing) c = 'none';
    else if (hoverMarker) c = 'pointer';
    else if (spaceDown || tool === 'move') c = 'grab';
    canvas.style.cursor = c;
  }

  const typing = e => e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;

  window.addEventListener('keydown', e => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (e.ctrlKey && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (e.ctrlKey && k === 's') { e.preventDefault(); saveFile(); return; }
    if (e.ctrlKey) return;
    if (e.key === ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; updateCursor(); requestDraw(); } return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); return; }
    if (e.key === 'Escape') { setPlacing(null); selectMarker(null); return; }
    if (/^[1-9]$/.test(e.key)) { const b = BIOMES[+e.key - 1]; if (b) setBiome(b.id); return; }
    if (e.key === '[') setSize(Math.max(0, sizeIdx - 1));
    if (e.key === ']') setSize(Math.min(SIZES.length - 1, sizeIdx + 1));
    if (k === 'b') setTool('brush');
    if (k === 'm') setTool('move');
    if (k === 'p') setShowPlaces(!showPlaces);
    if (k === 't' && detailsOf(biome).length) {
      // Step through Land and each detail of the biome.
      const all = ['land', ...detailsOf(biome)];
      setLayer(all[(all.indexOf(layer) + 1) % all.length]);
    }
    if (e.key === '+' || e.key === '=') zoomAt(W / 2, H / 2, 1.3);
    if (e.key === '-') zoomAt(W / 2, H / 2, 1 / 1.3);
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ') { spaceDown = false; updateCursor(); requestDraw(); }
  });

  // ---------- Side panels ----------
  function isLight(hex) {
    const [r, g, b] = hexRgb(hex);
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
  }

  function buildBiomes() {
    const box = $('#biomes');
    BIOMES.forEach((b, idx) => {
      const btn = document.createElement('button');
      btn.className = 'biome';
      btn.dataset.id = b.id;
      btn.title = `${b.name} (key ${idx + 1})`;
      const sw = document.createElement('span');
      sw.className = 'swatch';
      sw.style.background = b.color;
      const icon = svgIcon(b.icon);
      icon.style.fill = isLight(b.color) ? 'rgba(0,0,0,.65)' : '#fff';
      sw.appendChild(icon);
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = b.name;
      btn.append(sw, name);
      btn.addEventListener('click', () => setBiome(b.id));
      box.appendChild(btn);
    });
  }

  // Land, plus one button per detail the biome has in the game (trees, peaks, lava...).
  function buildLayers() {
    const b = biomeById[biome];
    const box = $('#layerBox');
    const kinds = detailsOf(biome);
    box.hidden = !kinds.length;
    if (!kinds.length) return;
    $('#layerTitle').textContent = `Draw on ${b.name}`;

    const land = document.createElement('button');
    land.className = 'layer' + (layer === 'land' ? ' on' : '');
    land.dataset.layer = 'land';
    land.title = `${b.name} land (removes details)`;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.style.background = b.color;
    const svg = svgIcon(b.icon);
    svg.style.fill = isLight(b.color) ? 'rgba(0,0,0,.65)' : '#fff';
    chip.appendChild(svg);
    const landText = document.createElement('span');
    landText.textContent = 'Land';
    land.append(chip, landText);
    land.addEventListener('click', () => setLayer('land'));

    $('#layers').replaceChildren(land, ...kinds.map(kind => {
      const btn = document.createElement('button');
      btn.className = 'layer' + (layer === kind ? ' on' : '');
      btn.dataset.layer = kind;
      btn.title = `Add ${DETAILS[kind].name.toLowerCase()} (T switches)`;
      const text = document.createElement('span');
      text.textContent = DETAILS[kind].name;
      btn.append(detailPreview(kind, b.color), text);
      btn.addEventListener('click', () => setLayer(kind));
      return btn;
    }));
  }

  // Small picture of a detail standing on a patch of the biome's ground.
  function detailPreview(kind, ground) {
    const dpr = window.devicePixelRatio || 1;
    const cv = document.createElement('canvas');
    cv.width = cv.height = Math.round(40 * dpr);
    cv.style.width = cv.style.height = '40px';
    const g = cv.getContext('2d');
    g.scale(dpr, dpr);
    const d = DETAILS[kind];
    g.beginPath();
    g.ellipse(20, 33, 18, 6, 0, 0, Math.PI * 2);
    g.fillStyle = ground;
    g.fill();
    if (d.type === 'area') {
      g.beginPath();
      g.ellipse(20, 26, 15, 9, 0, 0, Math.PI * 2);
      g.fillStyle = d.color;
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = d.edge;
      g.stroke();
      if (kind === 'lava') {
        g.beginPath();
        g.ellipse(20, 26, 8, 4, 0, 0, Math.PI * 2);
        g.fillStyle = '#ffc64a';
        g.fill();
      }
    } else if (d.type === 'tree') {
      drawTree(g, kind, 20, 34, 28 * Math.min(1.1, TREE_LOOK[kind].size), false);
    } else {
      const h = { peak: 30, hill: 14, snowhill: 14, boulders: 16, rocks: 20 }[kind] || 30;
      drawGlyph(g, kind, 20, 34, h, false);
    }
    return cv;
  }

  function buildSizes() {
    const box = $('#sizes');
    SIZES.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.className = 'size';
      btn.title = `${s.name} brush ( [ and ] )`;
      const dot = document.createElement('span');
      dot.style.width = dot.style.height = `${s.dot}px`;
      btn.appendChild(dot);
      btn.addEventListener('click', () => setSize(i));
      box.appendChild(btn);
    });
  }

  function buildTools() {
    const box = $('#tools');
    for (const [id, label, icon, key] of [
      ['brush', 'Paint', CATALOG.ui.brush, 'B'],
      ['move', 'Move', CATALOG.ui.move, 'M'],
    ]) {
      const btn = document.createElement('button');
      btn.className = 'tool';
      btn.dataset.tool = id;
      btn.title = `${label} (${key})`;
      const text = document.createElement('span');
      text.textContent = label;
      btn.append(svgIcon(icon), text);
      btn.addEventListener('click', () => setTool(id));
      box.appendChild(btn);
    }
  }

  function placeButton(p) {
    const def = placeByKey[p.key];
    const btn = document.createElement('button');
    btn.className = 'place';
    btn.dataset.key = p.key;
    btn.title = `Add ${p.label}`;
    const badge = document.createElement('span');
    badge.className = 'badge' + (def.boss ? ' boss' : '');
    const art = artFor(p.key);
    if (art) {
      badge.style.background = GAME_BADGE;
      const img = document.createElement('img');
      img.src = art.src;
      img.alt = '';
      badge.appendChild(img);
    } else {
      badge.style.background = placeBadge(def);
      badge.appendChild(svgIcon(p.icon));
    }
    const plus = document.createElement('span');
    plus.className = 'plus';
    plus.textContent = '+';
    const label = document.createElement('span');
    label.textContent = p.short || p.label;   // the full name is in the tooltip
    btn.append(plus, badge, label);
    btn.addEventListener('click', () => setPlacing(placing === p.key ? null : p.key));
    return btn;
  }

  function buildPlaces() {
    const b = biomeById[biome];
    const title = $('#placesTitle');
    title.replaceChildren();
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = b.color;
    const t = document.createElement('span');
    t.textContent = `${b.name} places`;
    title.append(dot, t);
    $('#places').replaceChildren(...(CATALOG.places[b.key] || []).map(placeButton));
    syncPlaceButtons();
  }

  function buildCommon() {
    $('#common').replaceChildren(...CATALOG.common.map(placeButton));
  }

  function syncPlaceButtons() {
    document.querySelectorAll('.place').forEach(el => el.classList.toggle('on', el.dataset.key === placing));
  }

  function setBiome(id) {
    biome = id;
    layer = 'land';
    if (tool === 'move') tool = 'brush';
    document.querySelectorAll('.biome').forEach(el => el.classList.toggle('on', +el.dataset.id === id));
    syncTools();
    buildLayers();
    buildPlaces();
    updateHint();
    requestDraw();
  }

  function setLayer(id) {
    layer = id;
    if (tool === 'move') tool = 'brush';
    setPlacing(null);
    document.querySelectorAll('.layer').forEach(el => el.classList.toggle('on', el.dataset.layer === id));
    syncTools();
    updateHint();
    updateCursor();
  }

  function setSize(i) {
    sizeIdx = i;
    if (tool !== 'brush') setTool('brush');
    document.querySelectorAll('.size').forEach((el, j) => el.classList.toggle('on', j === i));
    requestDraw();
  }

  function setTool(t) {
    tool = t;
    setPlacing(null);
    syncTools();
    updateHint();
    updateCursor();
    requestDraw();
  }

  function syncTools() {
    document.querySelectorAll('.tool').forEach(el => el.classList.toggle('on', el.dataset.tool === tool));
  }

  // Show or hide all places on the map, to see the land under them.
  function setShowPlaces(on) {
    showPlaces = on;
    $('#placesBtn').classList.toggle('on', on);
    if (!on) { selectMarker(null); hoverMarker = null; updateCursor(); }
    requestDraw();
  }

  function setPlacing(key) {
    placing = key;
    if (key && !showPlaces) setShowPlaces(true);
    if (key) selectMarker(null);
    syncPlaceButtons();
    updateHint();
    updateCursor();
    requestDraw();
  }

  function updateHint() {
    const b = biomeById[biome];
    const what = layer !== 'land' ? DETAILS[layer].name.toLowerCase() : '';
    let text;
    if (placing) text = `Click on the map to put "${placeByKey[placing].label}"  ·  Esc = cancel`;
    else if (tool === 'move') text = 'Drag to move the map  ·  Mouse wheel = zoom';
    else if (layer !== 'land') text = `Drag over the ${b.name} to add ${what}  ·  Paint land or water to remove it`;
    else if (b.id === 0) text = 'Drag to paint water (erases land)  ·  Right-drag = move map  ·  Wheel = zoom';
    else text = `Drag to paint ${b.name}  ·  Right-drag = move map  ·  Wheel = zoom`;
    $('#hint').textContent = text;
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('#toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
  }

  // ---------- Popup ----------
  let labelBefore = null;
  $('#popupDelete').appendChild(svgIcon(CATALOG.ui.trash));
  $('#popupDelete').addEventListener('click', deleteSelected);
  $('#popupClose').addEventListener('click', () => selectMarker(null));
  popupLabel.addEventListener('focus', () => { labelBefore = JSON.stringify(markers); });
  popupLabel.addEventListener('input', () => {
    const m = markers.find(mm => mm.id === selectedId);
    if (!m) return;
    m.label = popupLabel.value.slice(0, 40);
    requestDraw();
  });
  popupLabel.addEventListener('change', () => {
    const after = JSON.stringify(markers);
    if (labelBefore && after !== labelBefore) pushUndo({ type: 'markers', before: labelBefore, after });
    labelBefore = after;
    markDirty();
  });
  popupLabel.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === 'Escape') { popupLabel.blur(); selectMarker(null); }
  });

  // ---------- Save / load ----------
  function encodeCells(arr) {
    const out = [];
    let i = 0;
    while (i < arr.length) {
      const v = arr[i];
      let run = 1;
      while (run < 255 && i + run < arr.length && arr[i + run] === v) run++;
      out.push(v, run);
      i += run;
    }
    const bytes = Uint8Array.from(out);
    let s = '';
    for (let j = 0; j < bytes.length; j += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(j, j + 0x8000));
    return btoa(s);
  }

  function decodeCells(b64, valid) {
    const s = atob(b64);
    const out = new Uint8Array(N * N);
    let o = 0;
    for (let j = 0; j + 1 < s.length; j += 2) {
      const v = s.charCodeAt(j);
      const run = s.charCodeAt(j + 1);
      if (!valid(v) || o + run > out.length) throw new Error('bad cells');
      out.fill(v, o, o + run);
      o += run;
    }
    if (o !== out.length) throw new Error('bad cells size');
    return out;
  }

  function serialize() {
    return {
      app: 'ValMap',
      version: 4,
      name: worldName,
      grid: encodeCells(grid),
      detail: encodeCells(detail),
      markers,
      view: { x: Math.round(view.x), z: Math.round(view.z), s: view.s },
    };
  }

  function deserialize(data, { keepView = false } = {}) {
    if (!data || data.app !== 'ValMap' || ![1, 2, 3, 4].includes(data.version)) throw new Error('not a ValMap file');
    const g = decodeCells(data.grid, v => !!biomeById[v]);
    let d = new Uint8Array(N * N);
    if (data.detail) {
      d = decodeCells(data.detail, v => data.version !== 2 || v <= 8);
      if (data.version < 4) {
        // Older saves stored details differently; turn them into each biome's own bits.
        // v3: one bit per kind for all biomes (beech 0, birch 1, oak 2, fir 3, pine 4, snowfir 5, lava 7).
        // v2: one value per cell (1 = mixed forest, 2 = lava, 3..8 = beech..snowfir).
        const V3_BITS = ['beech', 'birch', 'oak', 'fir', 'pine', 'snowfir', null, 'lava'];
        for (let i = 0; i < d.length; i++) {
          const v = d[i];
          if (!v) continue;
          const b = g[i];
          let kinds;
          if (data.version === 2) {
            kinds = v === 1 ? detailsOf(b).filter(k => DETAILS[k].type === 'tree') : [v === 2 ? 'lava' : V3_BITS[v - 3]];
          } else {
            kinds = V3_BITS.filter((k, n) => k && v & (1 << n));
          }
          let bits = 0;
          for (const k of kinds) bits |= detailBit(b, k);
          d[i] = bits;
        }
      }
    }
    // Keep only details that each cell's biome can have.
    for (let i = 0; i < d.length; i++) if (d[i]) d[i] &= ALL_MASK[g[i]];
    const ms = [];
    let id = 1;
    for (const m of Array.isArray(data.markers) ? data.markers : []) {
      if (!m || !placeByKey[m.type] || !Number.isFinite(m.x) || !Number.isFinite(m.z)) continue;
      ms.push({ id: id++, type: m.type, x: m.x, z: m.z, label: typeof m.label === 'string' ? m.label.slice(0, 40) : '' });
    }
    grid.set(g);
    detail.set(d);
    markers = ms;
    nextId = id;
    worldName = typeof data.name === 'string' ? data.name.slice(0, 40) : '';
    $('#worldName').value = worldName;
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoButtons();
    selectMarker(null);
    clearTiles();
    redrawAllCells();
    const v = data.view;
    if (keepView && v && Number.isFinite(v.x) && Number.isFinite(v.z) && Number.isFinite(v.s)) {
      view.x = v.x; view.z = v.z; view.s = v.s;
      return true;
    }
    return false;
  }

  let saveTimer = 0;
  function markDirty() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosave, 800);
  }
  function autosave() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(serialize()));
    } catch {
      toast('Could not autosave. Use Save to keep your map!');
    }
  }

  const fileBase = () => (worldName.trim() || 'my-valheim-map').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function saveFile() {
    const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
    const name = `${fileBase()}.valmap`;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: 'ValMap map', accept: { 'application/json': ['.valmap'] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        toast('Map saved!');
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    download(blob, name);
    toast('Map saved to Downloads!');
  }

  $('#openFile').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      deserialize(JSON.parse(await file.text()));
      fitView();
      autosave();
      toast('Map opened!');
    } catch {
      toast('That file is not a ValMap map.');
    }
  });

  function savePicture() {
    const size = 2400;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    g.fillStyle = '#241a13';
    g.fillRect(0, 0, size, size);
    const cam = { x: 0, z: 0, s: (size * 0.44) / WORLD_R, w: size, h: size };
    renderWorld(g, cam, { k: 1.2, ui: 1.6, allLabels: true });
    g.font = 'bold 56px Georgia, serif';
    g.textAlign = 'left';
    g.textBaseline = 'top';
    g.fillStyle = GOLD;
    g.fillText(worldName.trim() || 'My Valheim Map', 40, 32);
    c.toBlob(blob => { download(blob, `${fileBase()}.png`); toast('Picture saved to Downloads!'); }, 'image/png');
  }

  function newMap() {
    if (!confirm('Start a new empty map?\n\nYour current map will be cleared. Save it first if you want to keep it!')) return;
    grid.fill(0);
    detail.fill(0);
    markers = [];
    nextId = 1;
    worldName = '';
    $('#worldName').value = '';
    undoStack.length = 0;
    redoStack.length = 0;
    updateUndoButtons();
    selectMarker(null);
    clearTiles();
    redrawAllCells();
    fitView();
    autosave();
    toast('New map! Pick a land and start painting.');
  }

  // ---------- Bug reports ----------
  // A report becomes a pre-filled GitHub issue on the project, which the reporter checks and sends.
  // js/bugcheck.js only lets short, plain sentences through. tools/export-bug-reports.js
  // collects the reports into a JSON file (and checks them again).
  const BUG_REPO = 'https://github.com/Threven1/ValMap';
  const BUG_TITLE = 'Bug report: ';
  const BUG_WAIT_MS = 60 * 1000;          // one report per minute from the same browser
  const BUG_LAST_KEY = 'valmap.lastBugReport';
  const bugDialog = $('#bugDialog');
  const bugText = $('#bugText');

  function openBugDialog() {
    bugText.value = '';
    updateBugCount();
    $('#bugError').textContent = '';
    bugDialog.hidden = false;
    bugText.focus();
  }

  function closeBugDialog() {
    bugDialog.hidden = true;
  }

  function updateBugCount() {
    $('#bugCount').textContent = `${[...bugText.value].length} / ${BUGCHECK.MAX}`;
  }

  // Browser name and version only, nothing that identifies the person.
  function browserName() {
    const ua = navigator.userAgent;
    const m = ua.match(/(Edg|OPR|Firefox|Chrome|Version)\/(\d+)/);
    if (!m) return 'unknown browser';
    const name = { Edg: 'Edge', OPR: 'Opera', Version: 'Safari' }[m[1]] || m[1];
    return `${name} ${m[2]}`;
  }

  function sendBugReport() {
    const result = BUGCHECK.check(bugText.value);
    if (result.error) {
      $('#bugError').textContent = result.error;
      bugText.focus();
      return;
    }
    let last = 0;
    try { last = +localStorage.getItem(BUG_LAST_KEY) || 0; } catch { /* no limit without storage */ }
    if (Date.now() - last < BUG_WAIT_MS) {
      $('#bugError').textContent = 'Please wait a minute before sending another report.';
      return;
    }
    const title = BUG_TITLE + [...result.text].slice(0, 60).join('');
    const body = `${result.text}\n\n---\nValMap · ${browserName()} · ${screen.width}x${screen.height}`;
    const url = `${BUG_REPO}/issues/new?${new URLSearchParams({ title, body, labels: 'bug' })}`;
    window.open(url, '_blank', 'noopener');
    try { localStorage.setItem(BUG_LAST_KEY, String(Date.now())); } catch { /* not remembered */ }
    closeBugDialog();
    toast('Thanks! Check and send the report on GitHub.');
  }

  $('#bugBtn').addEventListener('click', openBugDialog);
  $('#bugCancel').addEventListener('click', closeBugDialog);
  $('#bugSend').addEventListener('click', sendBugReport);
  bugText.addEventListener('input', () => { updateBugCount(); $('#bugError').textContent = ''; });
  bugDialog.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeBugDialog();
    if (e.key === 'Enter' && e.ctrlKey) sendBugReport();
  });
  bugDialog.addEventListener('click', e => { if (e.target === bugDialog) closeBugDialog(); });

  // ---------- Credits ----------
  const creditsDialog = $('#creditsDialog');
  $('#creditsBtn').addEventListener('click', () => { creditsDialog.hidden = false; $('#creditsClose').focus(); });
  $('#creditsClose').addEventListener('click', () => { creditsDialog.hidden = true; });
  creditsDialog.addEventListener('keydown', e => { if (e.key === 'Escape') creditsDialog.hidden = true; });
  creditsDialog.addEventListener('click', e => { if (e.target === creditsDialog) creditsDialog.hidden = true; });

  // ---------- Top bar ----------
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#zoomInBtn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.4));
  $('#zoomOutBtn').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.4));
  $('#fitBtn').addEventListener('click', fitView);
  $('#ringsBtn').addEventListener('click', e => {
    showRings = !showRings;
    e.currentTarget.classList.toggle('on', showRings);
    requestDraw();
  });
  $('#placesBtn').addEventListener('click', () => setShowPlaces(!showPlaces));
  $('#gameBtn').addEventListener('click', () => setGameLook(!gameLook));

  // ---------- Game look ----------
  const GAME_LOOK_KEY = 'valmap.gameLook';
  let gameArtReady = false;
  let gameUiReady = false;          // all of CATALOG.gameUi was found in the game art

  function setGameLook(on) {
    gameLook = on && gameArtReady;
    $('#gameBtn').classList.toggle('on', gameLook);
    document.body.classList.toggle('game-ui', gameLook && gameUiReady);
    try { localStorage.setItem(GAME_LOOK_KEY, gameLook ? '1' : '0'); } catch { /* not saved */ }
    clearTiles();
    buildCommon();
    buildPlaces();
    requestDraw();
  }

  // Load the art made by tools/build-game-assets.js, if it exists, and keep texture pixels for tiles.
  function loadGameArt() {
    if (!GAME) return;
    $('#gameBtn').hidden = false;
    // The game's wooden boards and buttons for the panels, as --tex-* CSS variables (see style.css).
    const ui = Object.entries(CATALOG.gameUi);
    gameUiReady = ui.every(([, name]) => GAME[name]);
    if (gameUiReady) {
      for (const [v, name] of ui) document.documentElement.style.setProperty(`--tex-${v}`, `url("${GAME[name]}")`);
    }
    const entries = Object.entries(GAME);
    let pending = entries.length;
    const done = () => {
      if (--pending > 0) return;
      gameArtReady = true;
      let pref = '1';
      try { pref = localStorage.getItem(GAME_LOOK_KEY) ?? '1'; } catch { /* default on */ }
      setGameLook(pref === '1');
    };
    for (const [name, url] of entries) {
      const img = new Image();
      img.onload = () => {
        gameImg[name] = img;
        if (CATALOG.gameTextures.includes(name)) {
          const cv = document.createElement('canvas');
          cv.width = img.width;
          cv.height = img.height;
          const g = cv.getContext('2d');
          g.drawImage(img, 0, 0);
          gameTex[name] = { w: img.width, h: img.height, px: g.getImageData(0, 0, img.width, img.height).data };
        }
        done();
      };
      img.onerror = done;
      img.src = url;
    }
  }
  $('#saveBtn').addEventListener('click', saveFile);
  $('#openBtn').addEventListener('click', () => $('#openFile').click());
  $('#pictureBtn').addEventListener('click', savePicture);
  $('#newBtn').addEventListener('click', newMap);
  $('#worldName').addEventListener('input', e => { worldName = e.target.value; markDirty(); });
  $('#worldName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  window.addEventListener('beforeunload', autosave);

  // ---------- Start ----------
  buildBiomes();
  buildSizes();
  buildTools();
  buildCommon();
  loadGameArt();

  let restoredView = false;
  let restored = false;
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) { restoredView = deserialize(JSON.parse(saved), { keepView: true }); restored = true; }
  } catch {
    restoredView = false;
  }
  if (!restored) redrawAllCells();

  setBiome(1);
  setSize(sizeIdx);
  setTool('brush');
  updateUndoButtons();
  new ResizeObserver(resize).observe(stage);
  resize();
  toast(restored ? 'Welcome back, Viking!' : 'Pick a land on the left and paint!');
})();
