/*
 * Panefall weather engine.
 *
 * Weather falls over the whole screen: snow, rain, storms, autumn leaves or spring
 * blossoms. It lands on "surfaces" (the top edges of windows, the Dock, the bottom of the
 * screen): snow builds into piles, leaves and petals come to rest, rain splashes, and some
 * raindrops bead up on the glass of your windows and trickle down. Move a window and
 * whatever is on it falls off.
 *
 * Coordinates are CSS pixels (macOS points) local to one display. Nothing here knows about
 * Electron, so the same engine runs in the app, the browser demo and the website.
 */
(function (global) {
  'use strict';

  const COL = 3; // width of one pile column, px
  const BUCKET = 64; // horizontal bucket size for collision lookups, px
  const GRAVITY = 980; // px/s², for clumps, splashes and drops running off the glass
  const MAX_PARTICLES = 5000;
  const MAX_BEADS = 360;
  const TAU = Math.PI * 2;

  // Particle kinds.
  const FLAKE = 0; // falling snowflake
  const CHUNK = 1; // clump of snow knocked off a pile
  const SPRAY = 2; // powder or water splash, purely visual
  const DROP = 3; // raindrop
  const LEAF = 4; // autumn leaf or blossom petal
  const BALL = 5; // a snowball: thrown at a window, or what's left of a toppled snowman

  const HATS = ['top', 'beanie', 'beanie', 'none'];
  const SCARVES = ['#e2533c', '#2f9e6a', '#3b6cf6', '#f2b630', '#b04ad8'];
  const GUST_SECONDS = 2.6;

  // Per weather: particles per second for every 1000 px of width at an intensity of 0..1,
  // how strong the gusts get (px/s), and roughly how fast it falls (to pre-fill the sky).
  const WEATHERS = {
    snow: { rate: (i) => 4 + 76 * Math.pow(i, 1.5), gust: 16, speed: 45 },
    rain: { rate: (i) => 40 + 420 * Math.pow(i, 1.4), gust: 26, speed: 780 },
    storm: { rate: (i) => 260 + 420 * i, gust: 85, speed: 820 },
    leaves: { rate: (i) => 0.6 + 6 * i, gust: 45, speed: 55 },
    blossoms: { rate: (i) => 2 + 16 * i, gust: 28, speed: 40 },
    clear: { rate: () => 0, gust: 8, speed: 1 },
  };

  const LEAF_COLORS = ['#d9822b', '#c4502a', '#e8b33a', '#a5452a', '#b9772f', '#e09f3e', '#8f3b1f'];
  const PETAL_COLORS = ['#f8c8d4', '#f4a7bb', '#fde4ea', '#f7b6c8', '#fbd3dc'];

  const SLOPE = 1.5; // steepest step between neighbouring columns before snow slides
  const ACCUMULATION = 1.3; // pile area added per unit of flake area
  const GROUND_ACCUMULATION = 0.35; // the ground fills slower so the snowplow is an occasional treat
  const WINDOW_INSET = 5; // keep piles off the rounded window corners
  const MAX_WIND = 70; // px/s of steady wind at wind = ±1
  const UMBRELLA = 62; // radius of the invisible canopy over the mouse pointer, px

  const DEFAULTS = {
    weather: 'snow',
    intensity: 0.35,
    wind: 0.15,
    size: 1,
    depth: 0.5,
    collectOnWindows: true,
    collectOnDock: true,
    plow: true,
    lightning: true,
  };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

  function removeAt(list, i) {
    list[i] = list[list.length - 1];
    list.pop();
  }

  // Stable per-column bumpiness so piles look lumpy rather than perfectly smooth.
  function lumpiness(n) {
    const t = new Float32Array(n);
    const a = rand(0, TAU);
    const b = rand(0, TAU);
    const c = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      t[i] = 0.5 * Math.sin(i * 0.9 + a) + 0.3 * Math.sin(i * 0.37 + b) + 0.2 * Math.sin(i * 2.1 + c);
    }
    return t;
  }

  // Maximum height per column: lower at the ends so piles round off at the corners, and
  // gently uneven so a full pile undulates instead of looking like a flat strip.
  function edgeCaps(n, maxH, rounded, tex) {
    const caps = new Float32Array(n);
    for (let c = 0; c < n; c++) {
      const d = Math.min(c, n - 1 - c);
      const edge = rounded ? 0.4 + 0.6 * Math.sqrt(Math.min(1, d / 7)) : 1;
      caps[c] = maxH * edge * (1 + 0.12 * tex[c]);
    }
    return caps;
  }

  function pileHeight(kind, depth) {
    const windowPile = 6 + 20 * depth;
    if (kind === 'ground') return 4 + 14 * depth;
    if (kind === 'dock') return windowPile * 0.65;
    return windowPile;
  }

  function makeCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    return canvas;
  }

  function makeFlakeSprite() {
    const size = 48;
    const canvas = makeCanvas(size);
    const g = canvas.getContext('2d');
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.36, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.55, 'rgba(236,243,252,0.45)');
    // A faint cool rim keeps flakes visible over white windows.
    grad.addColorStop(0.75, 'rgba(150,170,205,0.12)');
    grad.addColorStop(1, 'rgba(150,170,205,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, size, size);
    return canvas;
  }

  // A water droplet on glass: a clear body with a dark refracting rim (reads on light
  // windows), a bright glint and caustic (reads on dark ones) and a soft contact shadow.
  function makeBeadSprite() {
    const s = 48;
    const c = s / 2;
    const R = s * 0.4;
    const canvas = makeCanvas(s);
    const g = canvas.getContext('2d');
    // contact shadow, offset down
    let grad = g.createRadialGradient(c, c + R * 0.25, R * 0.6, c, c + R * 0.25, R * 1.15);
    grad.addColorStop(0, 'rgba(10,20,40,0.22)');
    grad.addColorStop(1, 'rgba(10,20,40,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
    // body
    grad = g.createRadialGradient(c, c + R * 0.15, 0, c, c, R);
    grad.addColorStop(0, 'rgba(235,243,255,0.22)');
    grad.addColorStop(0.65, 'rgba(200,215,238,0.16)');
    grad.addColorStop(0.86, 'rgba(40,58,92,0.5)');
    grad.addColorStop(1, 'rgba(40,58,92,0.15)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();
    // glint, upper left
    grad = g.createRadialGradient(c - R * 0.35, c - R * 0.4, 0, c - R * 0.35, c - R * 0.4, R * 0.42);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.55)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(c, c, R, 0, TAU);
    g.fill();
    // caustic, lower inside edge
    g.strokeStyle = 'rgba(255,255,255,0.6)';
    g.lineWidth = s * 0.05;
    g.beginPath();
    g.arc(c, c, R * 0.72, 0.18 * Math.PI, 0.82 * Math.PI);
    g.stroke();
    return canvas;
  }

  // Leaf and petal outlines, centred on the origin with the long axis along y.
  function leafPath(ctx, s, petal) {
    if (petal) {
      ctx.moveTo(0, s * 0.55);
      ctx.bezierCurveTo(-s * 0.55, s * 0.2, -s * 0.45, -s * 0.5, -s * 0.09, -s * 0.55);
      ctx.lineTo(0, -s * 0.42);
      ctx.lineTo(s * 0.09, -s * 0.55);
      ctx.bezierCurveTo(s * 0.45, -s * 0.5, s * 0.55, s * 0.2, 0, s * 0.55);
    } else {
      ctx.moveTo(0, -s * 0.6);
      ctx.bezierCurveTo(s * 0.48, -s * 0.32, s * 0.42, s * 0.3, 0, s * 0.6);
      ctx.bezierCurveTo(-s * 0.42, s * 0.3, -s * 0.48, -s * 0.32, 0, -s * 0.6);
    }
  }

  class Surface {
    constructor(key, kind, x, y, w, maxH) {
      this.key = key;
      this.kind = kind; // 'window' | 'dock' | 'ground'
      this.maxH = maxH;
      this.spill = [0, 0]; // snow about to tip over the left / right end, in column-height units
      this.dirty = false;
      this.snow = false; // has any snow on it (lets melting skip empty surfaces)
      this.place(x, y, w);
    }

    /** Moves the surface and empties it. */
    place(x, y, w) {
      this.x = x;
      this.y = y;
      this.w = w;
      this.n = Math.max(1, Math.ceil(w / COL));
      this.h = new Float32Array(this.n);
      this.vis = new Uint8Array(this.n);
      this.tex = lumpiness(this.n);
      this.caps = edgeCaps(this.n, this.maxH, this.kind !== 'ground', this.tex);
      this.items = []; // resting leaves and petals: { ox, tilt, squash, size, petal, color, age }
      this.snow = false;
    }

    setMaxH(maxH) {
      this.maxH = maxH;
      this.caps = edgeCaps(this.n, maxH, this.kind !== 'ground', this.tex);
      this.dirty = true;
    }

    col(x) {
      return Math.floor((x - this.x) / COL);
    }

    heightAt(x) {
      const c = this.col(x);
      return c >= 0 && c < this.n ? this.h[c] : 0;
    }

    visibleAt(x) {
      const c = this.col(x);
      return c >= 0 && c < this.n && this.vis[c] === 1;
    }
  }

  class Engine {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.width = 0;
      this.height = 0;
      this.dpr = 1;
      this.origin = { x: 0, y: 0 }; // this display's top-left, in global coordinates
      this.settings = { ...DEFAULTS };
      this.particles = [];
      this.beads = []; // raindrops stuck to window glass: { key, ox, oy, r, vy, hold, trail }
      this.surfaces = new Map(); // key -> Surface
      this.dormant = new Map(); // window key -> pile kept while its window is hidden
      this.buckets = [];
      this.ground = null;
      this.report = null; // latest report from the window tracker
      this.lastReportAt = 0;
      this.winRects = []; // windows in local coordinates, front to back
      this.fixedRects = []; // menu bars and the Dock, always in front of windows
      this.rectByKey = new Map();
      this.hitCol = 0;
      this.time = 0;
      this.frame = 0;
      this.wind = 0;
      this.spawnCarry = 0;
      this.warm = false;
      this.flash = 0;
      this.flashes = [];
      this.nextBolt = rand(3, 8);
      this.pointer = null; // mouse pointer in local coordinates: weather parts around it
      this.snowmen = [];
      this.gustTime = -1; // seconds into a gust of wind, or -1
      this.gustDir = 1;
      this.onEvent = null; // (name, data) => void: 'thunder', 'splat', 'snowman', 'topple', 'gust'
      this.flakeSprite = makeFlakeSprite();
      this.beadSprite = makeBeadSprite();
      this.plow = new global.PanefallPlow(this);
    }

    /** The mouse pointer in local coordinates, or null. Weather parts around it like an umbrella. */
    setPointer(point) {
      this.pointer = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
    }

    emit(name, data) {
      if (this.onEvent) this.onEvent(name, data);
    }

    // ------------------------------------------------------------ toys

    /**
     * Rolls a snowman out of the snow at `point` (on the window under it, or the first ledge
     * below it), or somewhere sensible when `point` is null.
     */
    buildSnowman(point) {
      if (!this.width || !this.ground) return false;
      const spot = point ? { s: this.surfaceAt(point.x, point.y), x: point.x } : this.randomSpot();
      const s = spot.s;
      const x = clamp(spot.x, s.x + 18, s.x + s.w - 18);
      if (!s.visibleAt(x)) return false;
      if (this.snowmen.length >= 8) this.toppleSnowman(this.snowmen[0], 0);
      // It is rolled from the snow that is there.
      const c = s.col(x);
      for (let k = -10; k <= 10; k++) if (c + k >= 0 && c + k < s.n) s.h[c + k] *= 0.35;
      s.dirty = true;
      this.snowmen.push({
        surface: s,
        ox: x - s.x,
        scale: s.kind === 'ground' ? rand(1.05, 1.3) : rand(0.85, 1.05),
        age: 0,
        melt: 0,
        hat: pick(HATS),
        scarf: pick(SCARVES),
        facing: Math.random() < 0.5 ? -1 : 1,
        blink: rand(2, 5),
        seed: rand(0, 100),
      });
      for (let i = 0; i < 14; i++) this.addSpray(x + rand(-14, 14), s.y - 4, rand(-80, 80), -rand(60, 180));
      this.emit('snowman');
      return true;
    }

    /** Throws a snowball at the window under `point` (or a random window); it splats on the glass. */
    throwSnowball(point) {
      if (!this.width) return;
      const visible = this.winRects.filter((r) => r.x + r.w > 40 && r.x < this.width - 40 && r.y < this.height - 60 && r.y + r.h > 60);
      let rect = point ? this.glassAt(point.x, point.y) : null;
      if (!rect && visible.length) rect = pick(visible);
      let tx = point ? point.x : rand(this.width * 0.25, this.width * 0.75);
      let ty = point ? point.y : this.height * rand(0.3, 0.6);
      if (rect) {
        for (let tries = 0; tries < 24; tries++) {
          tx = rand(rect.x + 24, rect.x + rect.w - 24);
          ty = rand(rect.y + 34, rect.y + Math.min(rect.h - 24, 300));
          if (this.glassAt(tx, ty) === rect) break;
        }
      }
      // Thrown from the far bottom corner, in an arc that lands on target after T seconds.
      const fromLeft = tx > this.width / 2;
      const sx = fromLeft ? -20 : this.width + 20;
      const sy = this.height * 0.88;
      const T = 0.85;
      this.particles.push({
        kind: BALL,
        x: sx,
        y: sy,
        px: sx,
        py: sy,
        vx: (tx - sx) / T,
        vy: (ty - sy) / T - 0.5 * GRAVITY * T,
        r: 7,
        vol: 90,
        flight: 0,
        target: { rect, x: tx, y: ty, t: T },
        skip: null,
      });
    }

    /** A strong gust of wind: leaves lift off, snow blows off the ledges. */
    gust(direction) {
      this.gustDir = direction || (Math.random() < 0.5 ? -1 : 1);
      this.gustTime = 0;
      this.emit('gust', this.gustDir);
    }

    /** A flash of lightning (and, with sound on, the thunder that follows). */
    thunder() {
      this.flashes.push({ t: 0, peak: 0.26 }, { t: -0.18, peak: 0.15 });
      this.emit('thunder');
    }

    /** Where a snowman built at (x, y) would stand. */
    surfaceAt(x, y) {
      const glass = this.glassAt(x, y);
      if (glass) {
        const s = this.surfaces.get('w' + glass.id);
        if (s && s.visibleAt(x)) return s;
      }
      let best = null;
      for (const s of this.surfaces.values()) {
        if (s.y < y - 4 || !s.visibleAt(x)) continue;
        if (!best || s.y < best.y) best = s;
      }
      return best || this.ground;
    }

    /** A visible spot on a window ledge (or the ground) for a snowman built from a button. */
    randomSpot() {
      const ledges = [...this.surfaces.values()].filter((s) => s.kind === 'window' && s.w > 90 && s.vis.some((v) => v));
      for (let tries = 0; tries < 30 && ledges.length; tries++) {
        const s = pick(ledges);
        const x = rand(s.x + 24, s.x + s.w - 24);
        if (s.visibleAt(x)) return { s, x };
      }
      return { s: this.ground, x: rand(this.width * 0.15, this.width * 0.85) };
    }

    toppleSnowman(m, vx) {
      const i = this.snowmen.indexOf(m);
      if (i >= 0) this.snowmen.splice(i, 1);
      const s = m.surface;
      const x = s.x + m.ox;
      if (!s.visibleAt(x)) return;
      const k = m.scale * 1.2 * (1 - 0.3 * m.melt);
      let y = s.y - s.heightAt(x);
      for (const r of [14 * k, 10 * k, 7.5 * k]) {
        y -= r * 1.6;
        this.particles.push({ kind: BALL, x: x + rand(-3, 3), y, px: x, py: y, vx: clamp(vx * 0.2, -220, 220) + rand(-50, 50), vy: -rand(20, 90), r, vol: r * r * 2.2, flight: 0, target: null, skip: s });
      }
      this.emit('topple');
    }

    stepSnowmen(dt) {
      const weather = this.settings.weather;
      for (let i = this.snowmen.length - 1; i >= 0; i--) {
        const m = this.snowmen[i];
        m.age += dt;
        if (this.surfaces.get(m.surface.key) !== m.surface) {
          this.toppleSnowman(m, 0); // its window went away
          continue;
        }
        if (weather === 'rain' || weather === 'storm') m.melt += dt / 30;
        else if (weather !== 'snow') m.melt += dt / 120;
        if (m.melt >= 1) {
          this.snowmen.splice(i, 1);
          continue;
        }
        m.blink -= dt;
        if (m.blink < -0.14) m.blink = rand(2.5, 6);
      }
    }

    stepGust(dt) {
      if (this.gustTime < 0) return;
      this.gustTime += dt;
      if (this.gustTime > GUST_SECONDS) {
        this.gustTime = -1;
        return;
      }
      const env = Math.sin((Math.PI * this.gustTime) / GUST_SECONDS);
      this.wind += this.gustDir * 320 * env;
      if (env < 0.3) return;
      let budget = 30; // snow blown off the ledges this frame
      for (const s of this.surfaces.values()) {
        for (let i = s.items.length - 1; i >= 0; i--) {
          if (Math.random() < dt * 6 * env && s.visibleAt(s.x + s.items[i].ox)) {
            const [it] = s.items.splice(i, 1);
            this.liftItem(s, it, this.wind * rand(0.8, 1.2), -rand(40, 110));
          }
        }
        if (!s.snow) continue;
        for (let c = 0; c < s.n; c++) {
          if (s.h[c] < 1) continue;
          s.h[c] = Math.max(0, s.h[c] - 7 * env * dt);
          if (budget > 0 && s.vis[c] && Math.random() < 0.08) {
            budget--;
            this.addSpray(s.x + c * COL, s.y - s.h[c], this.wind * rand(0.6, 1.2), -rand(10, 70));
          }
        }
        s.dirty = true;
      }
    }

    // ------------------------------------------------------------ inputs

    resize(width, height, dpr) {
      if (width === this.width && height === this.height && dpr === this.dpr) return;
      this.width = width;
      this.height = height;
      this.dpr = dpr;
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);

      const old = this.ground;
      this.ground = new Surface('ground', 'ground', 0, height, width, pileHeight('ground', this.settings.depth));
      if (old) {
        this.ground.h.set(old.h.subarray(0, Math.min(old.n, this.ground.n)));
        this.ground.snow = old.snow;
      }
      this.ground.vis.fill(1);
      this.surfaces.set('ground', this.ground);
      this.rebuild(false);
    }

    setOrigin(x, y) {
      if (x === this.origin.x && y === this.origin.y) return;
      this.origin = { x, y };
      this.rebuild(false);
    }

    /** Accepts any subset of DEFAULTS' keys; unknown keys are ignored. */
    setSettings(next) {
      const prev = this.settings;
      const merged = { ...prev };
      for (const key of Object.keys(DEFAULTS)) if (next[key] !== undefined) merged[key] = next[key];
      if (!WEATHERS[merged.weather]) merged.weather = prev.weather;
      this.settings = merged;

      if (prev.collectOnWindows && !merged.collectOnWindows) {
        for (const s of [...this.surfaces.values()]) if (s.kind === 'window') this.removeSurface(s);
        this.dormant.clear();
      }
      if (merged.depth !== prev.depth) {
        for (const s of this.surfaces.values()) s.setMaxH(pileHeight(s.kind, merged.depth));
      }
      if (merged.weather !== prev.weather) this.spawnCarry = 0;
      this.rebuild(false);
    }

    /** report: { windows: [{id,x,y,w,h}] front-to-back, menubars: [{x,y,w,h}], dock: {x,y,w,h}|null } */
    setWindows(report) {
      this.report = report;
      this.rebuild(true);
    }

    /** Removes everything that has fallen or collected; whatever is in the air keeps falling. */
    clearAll() {
      for (const s of this.surfaces.values()) {
        s.h.fill(0);
        s.spill[0] = s.spill[1] = 0;
        s.items = [];
        s.snow = false;
      }
      this.dormant.clear();
      this.beads = [];
      this.snowmen = [];
      this.particles = this.particles.filter((p) => p.kind === FLAKE || p.kind === DROP || (p.kind === LEAF && p.skip === null));
      this.plow.reset();
    }

    groundFullness() {
      const h = this.ground ? this.ground.h : null;
      if (!h || !h.length) return 0;
      let sum = 0;
      for (let i = 0; i < h.length; i++) sum += h[i];
      return sum / h.length / this.ground.maxH;
    }

    // ------------------------------------------------------------ surfaces

    rebuild(fromTracker) {
      if (!this.width) return;
      const now = performance.now();
      // Time since the previous report, used to estimate how fast a window was dragged.
      const dt = clamp((now - this.lastReportAt) / 1000, 0.016, 0.1);
      if (fromTracker) this.lastReportAt = now;

      const report = this.report || { windows: [], menubars: [], dock: null };
      const ox = this.origin.x;
      const oy = this.origin.y;
      const local = (r) => ({ id: r.id, x: r.x - ox, y: r.y - oy, w: r.w, h: r.h });

      // Things that always sit in front of normal windows.
      const fixed = (report.menubars || []).map(local);
      const dock = report.dock ? local(report.dock) : null;
      if (dock) fixed.push(dock);

      const wins = this.settings.collectOnWindows ? (report.windows || []).map(local) : [];
      const depth = this.settings.depth;
      const seen = new Set(['ground']);

      for (let i = 0; i < wins.length; i++) {
        const r = wins[i];
        const key = 'w' + r.id;
        const x = r.x + WINDOW_INSET;
        const w = r.w - 2 * WINDOW_INSET;
        seen.add(key);
        let s = this.surfaces.get(key);
        if (s) {
          this.moveSurface(s, x, r.y, w, dt);
        } else {
          s = this.fromDormant(key, x, r.y, w) || new Surface(key, 'window', x, r.y, w, pileHeight('window', depth));
          this.surfaces.set(key, s);
        }
        this.computeVisibility(s, fixed, wins, i);
      }

      if (this.settings.collectOnDock && dock && dock.y > 2 && dock.y < this.height) {
        seen.add('dock');
        const x = dock.x + 8;
        const w = dock.w - 16;
        let s = this.surfaces.get('dock');
        if (s) this.moveSurface(s, x, dock.y, w, dt);
        else this.surfaces.set('dock', (s = new Surface('dock', 'dock', x, dock.y, w, pileHeight('dock', depth))));
        this.computeVisibility(s, [], [], 0);
      }

      // Surfaces whose window went away. One or two windows closing or minimising drop
      // what was on them; many vanishing at once (switching Spaces, hiding an app) keep it.
      const gone = [];
      for (const s of this.surfaces.values()) if (!seen.has(s.key)) gone.push(s);
      const windowsGone = gone.filter((s) => s.kind === 'window').length;
      for (const s of gone) {
        if (s.kind === 'window' && windowsGone > 2) {
          this.dormant.set(s.key, { x: s.x, y: s.y, w: s.w, h: s.h, items: s.items, snow: s.snow, until: now + 10 * 60 * 1000 });
          this.surfaces.delete(s.key);
        } else {
          this.removeSurface(s);
        }
      }
      for (const [key, d] of this.dormant) if (d.until < now) this.dormant.delete(key);

      // Raindrops on glass belong to a window: they fall off when it moves or disappears.
      const rectByKey = new Map();
      for (const r of wins) rectByKey.set('w' + r.id, r);
      this.releaseBeads(rectByKey);
      this.rectByKey = rectByKey;
      this.winRects = wins;
      this.fixedRects = fixed;

      this.buildBuckets();
    }

    moveSurface(s, x, y, w, dt) {
      const dx = x - s.x;
      const dy = y - s.y;
      const dw = w - s.w;
      if (dx === 0 && dy === 0 && dw === 0) return;

      if (dy !== 0 || dw === 0) {
        // Dragged (or resized from the top edge): everything on it loses its footing.
        for (const m of [...this.snowmen]) if (m.surface === s) this.toppleSnowman(m, dx / dt);
        this.shedColumns(s, 0, s.n, dx / dt, dy / dt);
        s.place(x, y, w);
        return;
      }

      // Resized from the left or right edge: keep what still has window under it.
      const oldX = s.x;
      const oldH = s.h;
      const hadSnow = s.snow;
      const keepFrom = clamp(Math.ceil((x - oldX) / COL), 0, s.n);
      const keepTo = clamp(Math.floor((x + w - oldX) / COL), keepFrom, s.n);
      this.shedColumns(s, 0, keepFrom, 0, 0);
      this.shedColumns(s, keepTo, s.n, 0, 0);
      const items = s.items;
      s.place(x, y, w);
      for (let c = keepFrom; c < keepTo; c++) {
        const nc = Math.round((oldX + c * COL - x) / COL);
        if (nc >= 0 && nc < s.n) s.h[nc] = oldH[c];
      }
      s.items = items.map((it) => ({ ...it, ox: it.ox + oldX - x }));
      for (const m of [...this.snowmen]) {
        if (m.surface !== s) continue;
        m.ox += oldX - x;
        if (m.ox < 10 || m.ox > w - 10) this.toppleSnowman(m, 0);
      }
      s.snow = hadSnow;
      s.dirty = true;
    }

    computeVisibility(s, fixed, wins, index) {
      const onScreen = s.y > 2 && s.y < this.height - 1;
      s.vis.fill(onScreen ? 1 : 0);
      if (!onScreen) return;
      this.hideRange(s, -Infinity, 0);
      this.hideRange(s, this.width, Infinity);
      // Anything in front that overlaps the band where this pile would sit hides that part.
      const bandTop = s.y - s.maxH - 2;
      const cover = (o) => {
        if (o.y < s.y && o.y + o.h > bandTop) this.hideRange(s, o.x, o.x + o.w);
      };
      for (const o of fixed) cover(o);
      for (let j = 0; j < index; j++) cover(wins[j]);
    }

    hideRange(s, x0, x1) {
      const c0 = Math.max(0, Math.floor((x0 - s.x) / COL));
      const c1 = Math.min(s.n, Math.ceil((x1 - s.x) / COL));
      if (c1 > c0) s.vis.fill(0, c0, c1);
    }

    fromDormant(key, x, y, w) {
      const d = this.dormant.get(key);
      if (!d) return null;
      this.dormant.delete(key);
      if (Math.abs(d.x - x) > 1 || Math.abs(d.y - y) > 1 || d.w !== w) return null;
      const s = new Surface(key, 'window', x, y, w, pileHeight('window', this.settings.depth));
      s.h.set(d.h.subarray(0, s.n));
      s.items = d.items;
      s.snow = d.snow;
      s.dirty = true;
      return s;
    }

    removeSurface(s) {
      this.shedColumns(s, 0, s.n, 0, 0);
      this.surfaces.delete(s.key);
    }

    buildBuckets() {
      const count = Math.ceil(this.width / BUCKET) + 1;
      const buckets = Array.from({ length: count }, () => []);
      for (const s of this.surfaces.values()) {
        if (s.x + s.w < 0 || s.x > this.width) continue;
        const b0 = clamp(Math.floor(s.x / BUCKET), 0, count - 1);
        const b1 = clamp(Math.floor((s.x + s.w) / BUCKET), 0, count - 1);
        for (let b = b0; b <= b1; b++) buckets[b].push(s);
      }
      this.buckets = buckets;
    }

    /** The window whose glass is visible at (x, y), or null for the desktop. */
    glassAt(x, y) {
      for (const f of this.fixedRects) if (inside(f, x, y)) return null;
      for (const r of this.winRects) if (inside(r, x, y)) return r;
      return null;
    }

    // ------------------------------------------------------------ spawning

    spawn(y) {
      switch (this.settings.weather) {
        case 'snow':
          return this.spawnFlake(y);
        case 'rain':
        case 'storm':
          return this.spawnDrop(y);
        case 'leaves':
          return this.spawnLeaf(y, false);
        case 'blossoms':
          return this.spawnLeaf(y, true);
        default:
          return undefined;
      }
    }

    spawnFlake(y) {
      if (this.particles.length >= MAX_PARTICLES) return;
      // Many small, slow, faint flakes far away; fewer big, fast, bright ones up close.
      const depth = Math.pow(Math.random(), 1.6);
      this.particles.push({
        kind: FLAKE,
        x: Math.random() * this.width,
        y: y === undefined ? -rand(4, 30) : y,
        px: 0,
        py: 0,
        vx: this.wind * 0.5,
        vy: 22 + depth * 48 + rand(-4, 4),
        r: (0.7 + depth * 2.4) * this.settings.size,
        depth,
        alpha: 0.35 + depth * 0.6,
        phase: rand(0, TAU),
        swayF: rand(0.6, 1.6),
        swayA: rand(6, 18) * (0.4 + depth),
        skip: null,
      });
    }

    spawnDrop(y) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const depth = Math.random();
      const vy = (620 + depth * 380) * rand(0.92, 1.08);
      // Start upwind so slanted rain still covers the whole screen.
      const drift = this.wind * 1.4 * (this.height / vy);
      this.particles.push({
        kind: DROP,
        x: rand(-20, this.width + 20) - drift,
        y: y === undefined ? -rand(10, 80) : y,
        px: 0,
        py: 0,
        vx: this.wind * 1.4,
        vy,
        term: vy,
        depth,
        // A few drops hit the glass of a window on their way down.
        glassY: this.settings.collectOnWindows && Math.random() < 0.09 ? rand(30, this.height) : Infinity,
        skip: null,
      });
    }

    spawnLeaf(y, petal) {
      if (this.particles.length >= MAX_PARTICLES) return;
      this.particles.push(this.makeLeaf(Math.random() * this.width, y === undefined ? -rand(10, 40) : y, petal, {
        size: (petal ? rand(4.5, 7.5) : rand(9, 16)) * this.settings.size,
        color: pick(petal ? PETAL_COLORS : LEAF_COLORS),
      }));
    }

    makeLeaf(x, y, petal, props) {
      return {
        kind: LEAF,
        petal,
        x,
        y,
        px: x,
        py: y,
        vx: this.wind,
        vy: 0,
        fall: petal ? rand(28, 50) : rand(38, 70),
        angle: rand(0, TAU),
        spin: rand(-2.5, 2.5),
        flip: rand(0, TAU),
        flipSpeed: rand(1.6, 3.6),
        sway: rand(12, 30),
        phase: rand(0, TAU),
        lift: 0,
        skip: null,
        ...props,
      };
    }

    addChunk(x, y, vx, vy, vol, from) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const r = clamp(Math.sqrt(vol) * rand(0.36, 0.5), 1.2, 4.8);
      // `skip` = the surface it broke off: it falls past that surface instead of re-landing.
      this.particles.push({ kind: CHUNK, x, y, px: x, py: y, vx, vy, vol, r, spin: rand(0, TAU), skip: from || null });
    }

    addSpray(x, y, vx, vy, water) {
      if (this.particles.length >= MAX_PARTICLES) return;
      this.particles.push({
        kind: SPRAY,
        x,
        y,
        px: x,
        py: y,
        vx,
        vy,
        water: Boolean(water),
        r: water ? rand(0.5, 1.0) : rand(0.6, 1.6),
        life: water ? rand(0.18, 0.4) : rand(0.35, 0.9),
      });
    }

    prewarm(weather) {
      // Fill the screen with weather already in flight instead of starting from an empty sky.
      const perSecond = weather.rate(this.settings.intensity) * (this.width / 1000);
      const count = Math.min(MAX_PARTICLES * 0.6, perSecond * (this.height / weather.speed));
      for (let i = 0; i < count; i++) this.spawn(rand(0, this.height));
    }

    // ------------------------------------------------------------ simulation

    step(dt) {
      if (!this.width) return;
      const weather = WEATHERS[this.settings.weather] || WEATHERS.clear;
      if (!this.warm) {
        this.prewarm(weather);
        this.warm = true;
      }
      this.time += dt;
      this.frame++;
      const t = this.time;
      const gusts = 0.55 * Math.sin(t * 0.23) + 0.3 * Math.sin(t * 0.61 + 1.3) + 0.15 * Math.sin(t * 1.7 + 0.4);
      this.wind = this.settings.wind * MAX_WIND + weather.gust * gusts;
      this.stepGust(dt);

      this.spawnCarry += weather.rate(this.settings.intensity) * (this.width / 1000) * dt;
      while (this.spawnCarry >= 1) {
        this.spawnCarry -= 1;
        this.spawn();
      }

      this.stepParticles(dt);
      this.stepBeads(dt);
      this.stepItems(dt);
      this.stepSnowmen(dt);
      this.melt(dt);
      for (const s of this.surfaces.values()) if (s.dirty) this.settle(s);
      this.stepLightning(dt);
      this.plow.step(dt);
    }

    stepParticles(dt) {
      const ps = this.particles;
      const W = this.width;
      const H = this.height;
      const t = this.time;
      const wind = this.wind;
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i];
        p.px = p.x;
        p.py = p.y;
        if (p.kind === FLAKE) {
          const target = wind * (0.35 + 0.65 * p.depth) + Math.sin(t * p.swayF + p.phase) * p.swayA;
          p.vx += (target - p.vx) * Math.min(1, dt * 1.5);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        } else if (p.kind === DROP) {
          p.vx += (wind * 1.4 - p.vx) * Math.min(1, dt * 4);
          if (p.vy < p.term) p.vy = Math.min(p.term, p.vy + GRAVITY * dt);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.y >= p.glassY) {
            p.glassY = Infinity;
            const glass = this.glassAt(p.x, p.y);
            if (glass) {
              this.addBead(glass, p.x, p.y, rand(1.2, 3.0) * Math.sqrt(this.settings.size));
              removeAt(ps, i);
              continue;
            }
          }
        } else if (p.kind === LEAF) {
          p.flip += p.flipSpeed * dt;
          const broad = Math.abs(Math.cos(p.flip)); // 1 when the leaf is flat to the air
          const target = wind * 0.9 + Math.sin(p.flip * 0.5 + p.phase) * p.sway;
          p.vx += (target - p.vx) * Math.min(1, dt * 1.8);
          p.lift *= 1 - Math.min(1, dt * 1.5);
          p.vy = p.fall * (1.15 - 0.5 * broad) + p.lift;
          p.angle += p.spin * dt * (0.4 + broad);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        } else if (p.kind === BALL) {
          p.vy += GRAVITY * dt;
          if (!p.target) p.vx *= 1 - Math.min(1, dt * 0.5);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.target) {
            p.flight += dt;
            if (p.flight >= p.target.t) {
              this.splat(p);
              removeAt(ps, i);
              continue;
            }
          }
        } else {
          p.vy += GRAVITY * dt;
          p.vx *= 1 - Math.min(1, dt * 0.8);
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          if (p.kind === SPRAY) {
            p.life -= dt;
            if (p.life <= 0) {
              removeAt(ps, i);
              continue;
            }
          }
        }

        if (this.pointer && (p.kind === FLAKE || p.kind === DROP || p.kind === LEAF)) this.shelter(p, this.pointer);

        if (p.kind === FLAKE || p.kind === LEAF) {
          if (p.x < -20) p.px = p.x += W + 40;
          else if (p.x > W + 20) p.px = p.x -= W + 40;
        } else if (p.x < -100 || p.x > W + 100) {
          removeAt(ps, i);
          continue;
        }
        if (p.y > H + 40) {
          removeAt(ps, i);
          continue;
        }
        // (A thrown snowball flies at the glass, over everything, until it lands.)
        if (p.kind !== SPRAY && !(p.kind === BALL && p.target) && p.y > p.py) {
          const s = this.findHit(p);
          if (s) {
            this.land(p, s, this.hitCol);
            removeAt(ps, i);
          }
        }
      }
    }

    /**
     * The umbrella: anything that falls into the dome above the pointer is pushed back onto
     * its surface and nudged outward, so it slides around the canopy and drips off the rim.
     */
    shelter(p, ptr) {
      const cx = ptr.x;
      const cy = ptr.y + 8; // the canopy sits just over the tip of the pointer
      const dx = p.x - cx;
      const dy = p.y - cy;
      if (dy > 0 || dx * dx + dy * dy > UMBRELLA * UMBRELLA) return;
      const d = Math.hypot(dx, dy) || 1;
      const side = dx > 0.5 ? 1 : dx < -0.5 ? -1 : Math.random() < 0.5 ? -1 : 1;
      p.x = cx + (dx / d) * UMBRELLA + side * 1.5;
      p.y = cy + (dy / d) * UMBRELLA;
      if (p.kind === DROP) {
        p.vx = side * rand(90, 160);
        if (Math.random() < 0.18) this.addSpray(p.x, p.y - 1, side * rand(20, 80), -rand(30, 90), true);
      } else {
        p.vx += side * 14;
      }
      p.px = p.x; // the push must not count as crossing a surface
      p.py = p.y;
    }

    /** The highest surface the particle crossed this frame, or null. Sets this.hitCol. */
    findHit(p) {
      const bucket = this.buckets[Math.floor(p.x / BUCKET)];
      if (!bucket) return null;
      let best = null;
      let bestTop = Infinity;
      let bestCol = 0;
      for (let k = 0; k < bucket.length; k++) {
        const s = bucket[k];
        if (p.x < s.x || p.skip === s) continue;
        const c = Math.floor((p.x - s.x) / COL);
        if (c >= s.n || !s.vis[c]) continue;
        const top = s.y - s.h[c];
        if (p.py <= top && p.y >= top && top < bestTop) {
          best = s;
          bestTop = top;
          bestCol = c;
        }
      }
      if (!best) return null;
      if (best.kind !== 'ground') {
        // Distant flakes and drops mostly pass in front of the window instead of landing.
        let chance = 1;
        if (p.kind === FLAKE) chance = 0.2 + 0.75 * p.depth;
        else if (p.kind === DROP) chance = 0.15 + 0.6 * p.depth;
        else if (p.kind === LEAF) chance = 0.8;
        if (Math.random() > chance) {
          p.skip = best;
          return null;
        }
      }
      this.hitCol = bestCol;
      return best;
    }

    land(p, s, c) {
      if (p.kind === FLAKE) {
        const k = s.kind === 'ground' ? GROUND_ACCUMULATION : ACCUMULATION;
        const size = this.settings.size;
        this.deposit(s, c, (Math.PI * p.r * p.r * k) / (size * size), 1);
      } else if (p.kind === CHUNK) {
        this.deposit(s, c, p.vol * 0.85, 3);
        const puffs = Math.min(5, 1 + Math.floor(p.vol / 25));
        for (let i = 0; i < puffs; i++) this.addSpray(p.x, p.y - 1, rand(-70, 70) + p.vx * 0.2, -rand(40, 140));
      } else if (p.kind === DROP) {
        if (Math.random() < (s.kind === 'ground' ? 0.25 : 0.5) && this.particles.length < MAX_PARTICLES - 300) {
          const n = Math.random() < 0.35 ? 2 : 1;
          for (let i = 0; i < n; i++) this.addSpray(p.x, p.y - 1, rand(-55, 55) + p.vx * 0.1, -rand(50, 150), true);
        }
        if (s.h[c] > 0) {
          s.h[c] = Math.max(0, s.h[c] - 0.3); // rain eats into snow
          s.dirty = true;
        }
      } else if (p.kind === LEAF) {
        this.restItem(s, p);
      } else if (p.kind === BALL) {
        this.deposit(s, c, p.vol, 4);
        for (let i = 0; i < 8; i++) this.addSpray(p.x, p.y - 2, rand(-110, 110), -rand(40, 160));
        this.emit('splat');
      }
    }

    /** A thrown snowball reaches its target: a burst of powder and a splat stuck to the glass. */
    splat(p) {
      const { x, y } = p.target;
      for (let i = 0; i < 16; i++) {
        const a = rand(0, TAU);
        const v = rand(60, 220);
        this.addSpray(x, y, Math.cos(a) * v, Math.sin(a) * v - 60);
      }
      const glass = this.glassAt(x, y);
      if (glass) {
        if (this.beads.length >= MAX_BEADS) this.beads.shift();
        this.beads.push({ key: 'w' + glass.id, ox: x - glass.x, oy: y - glass.y, r: rand(8, 11), vy: 0, hold: 0, trail: 0, dead: false, splat: true, life: 0, seed: rand(0, 100) });
      }
      this.emit('splat');
    }

    deposit(s, c, area, spread) {
      const total = area / COL; // height if it all went into one column
      const add = (col, v) => {
        if (col < 0) s.spill[0] += v;
        else if (col >= s.n) s.spill[1] += v;
        else s.h[col] += v;
      };
      if (spread <= 1) {
        // A flake settles into a soft little mound rather than a spike.
        add(c - 2, total * 0.11);
        add(c - 1, total * 0.22);
        add(c, total * 0.34);
        add(c + 1, total * 0.22);
        add(c + 2, total * 0.11);
      } else {
        let sum = 0;
        for (let k = -spread; k <= spread; k++) sum += spread + 1 - Math.abs(k);
        for (let k = -spread; k <= spread; k++) add(c + k, (total * (spread + 1 - Math.abs(k))) / sum);
      }
      s.dirty = true;
      s.snow = true;
    }

    /** Lets a pile slump to a natural slope and tip over its ends when it is full. */
    settle(s) {
      const h = s.h;
      const n = s.n;
      const caps = s.caps;
      let moved = false;

      for (let pass = 0; pass < 2; pass++) {
        const forward = ((pass + this.frame) & 1) === 0;
        for (let k = 0; k < n - 1; k++) {
          const c = forward ? k : n - 2 - k;
          const d = h[c] - h[c + 1];
          if (d > SLOPE) {
            const m = (d - SLOPE) * 0.5;
            h[c] -= m;
            h[c + 1] += m;
            moved = true;
          } else if (d < -SLOPE) {
            const m = (-d - SLOPE) * 0.5;
            h[c] += m;
            h[c + 1] -= m;
            moved = true;
          }
        }
      }

      // A full pile pushes its excess toward the nearer end, filling any dips on the way;
      // whatever reaches the end tips over.
      const mid = n >> 1;
      let carry = 0;
      for (let c = mid - 1; c >= 0; c--) {
        h[c] += carry;
        carry = Math.max(0, h[c] - caps[c]);
        h[c] -= carry;
        if (carry > 0) moved = true;
      }
      s.spill[0] += carry;
      carry = 0;
      for (let c = mid; c < n; c++) {
        h[c] += carry;
        carry = Math.max(0, h[c] - caps[c]);
        h[c] -= carry;
        if (carry > 0) moved = true;
      }
      s.spill[1] += carry;

      for (let side = 0; side < 2; side++) {
        const vol = s.spill[side] * COL;
        if (vol < 6) continue;
        s.spill[side] = 0;
        if (s.kind === 'ground') continue;
        const c = side === 0 ? 0 : n - 1;
        if (!s.vis[c]) continue;
        const x = side === 0 ? s.x - 4 : s.x + s.w + 4;
        this.addChunk(x, s.y - h[c], (side === 0 ? -1 : 1) * rand(8, 30), 0, vol, s);
      }

      if (!moved) s.dirty = false;
    }

    /** Breaks columns [c0, c1) of a surface loose: snow as falling clumps, leaves blown off. */
    shedColumns(s, c0, c1, vx, vy) {
      // The load is mostly left behind by a fast drag, so it only picks up a little speed.
      const pvx = clamp(vx * 0.18, -260, 260);
      const pvy = clamp(Math.min(0, vy) * 0.25, -260, 0);

      if (s.items.length) {
        const x0 = s.x + c0 * COL;
        const x1 = s.x + c1 * COL;
        const keep = [];
        for (const it of s.items) {
          const x = s.x + it.ox;
          if (x < x0 || x >= x1) keep.push(it);
          else if (s.kind !== 'ground' && s.visibleAt(x)) this.liftItem(s, it, pvx + rand(-30, 30), -rand(0, 50));
        }
        s.items = keep;
      }

      if (s.kind === 'ground') {
        s.h.fill(0, c0, c1);
        return;
      }
      let c = c0;
      while (c < c1) {
        // Uneven clumps: 2 to 5 columns each.
        const end = Math.min(c + 2 + Math.floor(Math.random() * 4), c1);
        let vol = 0;
        let top = 0;
        let visible = false;
        for (let k = c; k < end; k++) {
          vol += s.h[k] * COL;
          top = Math.max(top, s.h[k]);
          visible = visible || s.vis[k] === 1;
          s.h[k] = 0;
        }
        // Snow hidden behind another window can't be drawn falling in front of it.
        if (vol >= 2 && visible) {
          const x = s.x + ((c + end) / 2) * COL + rand(-1.5, 1.5);
          const y = s.y - top * rand(0.15, 0.9);
          this.addChunk(x, y, pvx + rand(-40, 40), pvy - rand(0, 90), vol, s);
          const puffs = Math.random() < 0.7 ? 1 + Math.floor(Math.random() * 2) : 0;
          for (let i = 0; i < puffs; i++) this.addSpray(x, y - rand(0, top * 0.5), pvx + rand(-60, 60), -rand(20, 130));
        }
        c = end;
      }
    }

    // --- leaves and petals at rest

    restItem(s, p) {
      const cap = s.kind === 'ground' ? Math.ceil(s.w / 9) : Math.ceil(s.w / 15);
      if (s.items.length >= cap) {
        const oldest = s.items.shift();
        if (s.kind !== 'ground') this.liftItem(s, oldest, rand(-20, 20), -rand(10, 30)); // nudged off by the newcomer
      }
      s.items.push({ ox: p.x - s.x, tilt: rand(-0.3, 0.3), squash: rand(0.4, 0.6), size: p.size, petal: p.petal, color: p.color, age: 0 });
    }

    liftItem(s, it, vx, vy) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const x = s.x + it.ox;
      const y = s.y - s.heightAt(x) - it.size * 0.2;
      const leaf = this.makeLeaf(x, y, it.petal, { size: it.size, color: it.color, angle: Math.PI / 2 + it.tilt, lift: vy, skip: s });
      leaf.vx = vx;
      this.particles.push(leaf);
    }

    stepItems(dt) {
      const gust = Math.abs(this.wind);
      for (const s of this.surfaces.values()) {
        if (!s.items.length) continue;
        for (let i = s.items.length - 1; i >= 0; i--) {
          const it = s.items[i];
          it.age += dt;
          if (s.kind === 'ground' && it.age > 150) {
            s.items.splice(i, 1); // ground leaves fade away after a while
            continue;
          }
          // Strong gusts pick resting leaves back up.
          if (gust > 30 && Math.random() < ((gust - 30) / 260) * dt && s.visibleAt(s.x + it.ox)) {
            s.items.splice(i, 1);
            this.liftItem(s, it, this.wind * rand(0.8, 1.3), -rand(30, 80));
          }
        }
      }
    }

    // --- raindrops on glass

    addBead(rect, x, y, r) {
      const key = 'w' + rect.id;
      const ox = x - rect.x;
      const oy = y - rect.y;
      for (const b of this.beads) {
        if (b.key === key && Math.abs(b.ox - ox) < b.r + r && Math.abs(b.oy - oy) < b.r + r) {
          b.r = Math.min(6.5, Math.hypot(b.r, r)); // joins a drop that is already there
          return;
        }
      }
      if (this.beads.length >= MAX_BEADS) this.beads.shift();
      this.beads.push({ key, ox, oy, r, vy: 0, hold: rand(0.4, 3), trail: 0, dead: false });
    }

    stepBeads(dt) {
      if (!this.beads.length) return;
      const wet = this.settings.weather === 'rain' || this.settings.weather === 'storm';
      const beads = this.beads;
      for (const b of beads) {
        if (b.dead) continue;
        const rect = this.rectByKey.get(b.key);
        if (!rect) {
          b.dead = true;
          continue;
        }
        if (b.splat) {
          // A snowball splat slides slowly down the glass and melts away.
          b.life += dt;
          b.oy += (3 + b.life * 1.5) * dt;
          if (b.life > 10 || b.oy > rect.h - 6) b.dead = true;
          continue;
        }
        // Drops dry up when the rain stops; the tiny ones left in trails always fade.
        if (!wet || b.r < 1.1) {
          b.r -= dt * (wet ? 0.02 : 0.06);
          if (b.r < 0.5) {
            b.dead = true;
            continue;
          }
        }
        // Heavy enough to run down the glass, in fits and starts; once running it keeps
        // going until the trail it leaves behind has used it up.
        if (b.r > 2.75) b.running = true;
        else if (b.r < 2.1) b.running = false;
        if (!b.running) continue;
        b.hold -= dt;
        if (b.hold > 0) continue;
        b.vy = Math.min(b.vy + 60 * dt, 25 + b.r * 9);
        if (Math.random() < dt * 0.6) {
          b.vy = 0;
          b.hold = rand(0.1, 0.6);
        }
        const dy = b.vy * dt;
        b.oy += dy;
        b.ox += Math.sin(b.oy * 0.15 + b.r) * 0.08;
        b.trail += dy;
        if (b.trail > 7) {
          b.trail = 0;
          b.r -= 0.05;
          if (beads.length < MAX_BEADS && Math.random() < 0.6) {
            beads.push({ key: b.key, ox: b.ox + rand(-0.6, 0.6), oy: b.oy - rand(3, 6), r: rand(0.8, 1.3), vy: 0, hold: 99, trail: 0, dead: false });
          }
        }
        // Swallow the droplets in its path.
        for (const o of beads) {
          if (o === b || o.dead || o.key !== b.key) continue;
          if (o.oy > b.oy - b.r && o.oy < b.oy + b.r + 1 && Math.abs(o.ox - b.ox) < b.r + o.r * 0.5) {
            b.r = Math.min(7, Math.hypot(b.r, o.r));
            o.dead = true;
          }
        }
        if (b.oy > rect.h - 3) {
          b.dead = true; // runs off the bottom edge
          this.dropFromGlass(rect, b);
        }
      }
      this.beads = beads.filter((b) => !b.dead);
    }

    /** Beads whose window moved, shrank or went away run off as falling drops. */
    releaseBeads(rectByKey) {
      if (!this.beads.length) return;
      const keep = [];
      for (const b of this.beads) {
        const was = this.rectByKey.get(b.key);
        const now = rectByKey.get(b.key);
        const still = was && now && now.x === was.x && now.y === was.y && b.ox < now.w - 1 && b.oy < now.h - 2;
        if (still) keep.push(b);
        else if (was) this.dropFromGlass(was, b);
      }
      this.beads = keep;
    }

    dropFromGlass(rect, b) {
      if (this.particles.length >= MAX_PARTICLES) return;
      const x = rect.x + b.ox;
      const y = rect.y + b.oy;
      if (b.splat) {
        this.addChunk(x, y, rand(-20, 20), 0, 60, null);
        return;
      }
      this.particles.push({ kind: DROP, x, y, px: x, py: y, vx: 0, vy: 120, term: 700, depth: 0.5, glassY: Infinity, skip: null });
    }

    // --- melting and lightning

    melt(dt) {
      const weather = this.settings.weather;
      if (weather === 'snow') return;
      const amount = (weather === 'rain' || weather === 'storm' ? 0.12 : 0.035) * dt;
      for (const s of this.surfaces.values()) {
        if (!s.snow) continue;
        let any = false;
        for (let c = 0; c < s.n; c++) {
          if (s.h[c] > 0) {
            s.h[c] = Math.max(0, s.h[c] - amount);
            any = true;
          }
        }
        s.snow = any;
      }
    }

    stepLightning(dt) {
      if (this.settings.weather === 'storm' && this.settings.lightning) {
        this.nextBolt -= dt;
        if (this.nextBolt <= 0) {
          this.nextBolt = rand(5, 16);
          this.flashes.push({ t: 0, peak: rand(0.14, 0.24) });
          if (Math.random() < 0.7) this.flashes.push({ t: -rand(0.12, 0.28), peak: rand(0.06, 0.14) });
          this.emit('thunder');
        }
      }
      let flash = 0;
      for (const f of this.flashes) {
        f.t += dt;
        if (f.t >= 0) flash = Math.max(flash, f.peak * Math.exp(-f.t * 12));
      }
      if (this.flashes.length) this.flashes = this.flashes.filter((f) => f.t < 0.6);
      this.flash = flash;
    }

    // ------------------------------------------------------------ drawing

    clearCanvas() {
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    draw() {
      const ctx = this.ctx;
      const d = this.dpr;
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);

      this.drawBeads();

      ctx.save();
      // A soft shadow gives white snow an edge against white windows.
      // (Canvas shadows are in device pixels and ignore the transform.)
      ctx.shadowColor = 'rgba(20, 32, 56, 0.32)';
      ctx.shadowBlur = 3 * d;
      ctx.shadowOffsetY = d;
      for (const s of this.surfaces.values()) this.drawPile(s);
      this.drawChunks();
      this.drawBalls();
      ctx.restore();

      for (const s of this.surfaces.values()) if (s.items.length) this.drawItems(s);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      this.drawSnowmen();

      this.plow.draw(ctx);
      this.drawDrops();
      this.drawLeaves();
      ctx.setTransform(d, 0, 0, d, 0, 0);
      this.drawFlakes();

      if (this.flash > 0.004) {
        ctx.fillStyle = `rgba(228, 235, 255, ${this.flash.toFixed(3)})`;
        ctx.fillRect(0, 0, this.width, this.height);
      }
    }

    drawPile(s) {
      const ctx = this.ctx;
      const { h, vis, tex, n } = s;
      const MIN = 0.4;
      const height = (k) => h[k] + tex[k] * Math.min(h[k], 8) * 0.16;
      const base = s.y + 0.5;
      let any = false;
      let c = 0;
      while (c < n) {
        if (!vis[c] || h[c] < MIN) {
          c++;
          continue;
        }
        let e = c;
        while (e < n && vis[e] && h[e] >= MIN) e++;
        if (!any) {
          ctx.beginPath();
          any = true;
        }
        // Smooth outline through the column centres (midpoint quadratic curves).
        const x0 = s.x + c * COL;
        const x1 = s.x + e * COL;
        let px = x0;
        let py = s.y - height(c) * 0.55;
        ctx.moveTo(x0, base);
        ctx.lineTo(px, py);
        for (let k = c; k < e; k++) {
          const x = s.x + (k + 0.5) * COL;
          const y = s.y - height(k);
          ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
          px = x;
          py = y;
        }
        const ey = s.y - height(e - 1) * 0.55;
        ctx.quadraticCurveTo(px, py, (px + x1) / 2, (py + ey) / 2);
        ctx.lineTo(x1, ey);
        ctx.lineTo(x1, base);
        ctx.closePath();
        c = e;
      }
      if (!any) return;
      const grad = ctx.createLinearGradient(0, s.y - 7, 0, base);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.5, '#f6f9fd');
      grad.addColorStop(1, '#d3deeb');
      ctx.fillStyle = grad;
      ctx.fill();
    }

    drawChunks() {
      const ctx = this.ctx;
      let any = false;
      for (const p of this.particles) {
        if (p.kind !== CHUNK) continue;
        if (!any) {
          ctx.beginPath();
          any = true;
        }
        ctx.moveTo(p.x + p.r, p.y);
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        const r2 = p.r * 0.62;
        const ax = p.x + Math.cos(p.spin) * p.r * 0.7;
        const ay = p.y + Math.sin(p.spin) * p.r * 0.5;
        ctx.moveTo(ax + r2, ay);
        ctx.arc(ax, ay, r2, 0, TAU);
      }
      if (!any) return;
      ctx.fillStyle = '#f7fafd';
      ctx.fill();
    }

    drawItems(s) {
      for (const it of s.items) {
        const x = s.x + it.ox;
        if (!s.visibleAt(x)) continue;
        const alpha = s.kind === 'ground' && it.age > 140 ? Math.max(0, (150 - it.age) / 10) : 1;
        const y = s.y - s.heightAt(x) - it.size * 0.18;
        this.drawLeafShape(x, y, it.size, Math.PI / 2 + it.tilt, it.squash, it.color, it.petal, alpha);
      }
    }

    drawLeaves() {
      for (const p of this.particles) {
        if (p.kind !== LEAF) continue;
        this.drawLeafShape(p.x, p.y, p.size, p.angle, 0.25 + 0.75 * Math.abs(Math.cos(p.flip)), p.color, p.petal, 1);
      }
    }

    drawLeafShape(x, y, size, angle, squash, color, petal, alpha) {
      const ctx = this.ctx;
      const d = this.dpr;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      // Rotate, then squash across the leaf to fake it tumbling in 3D.
      ctx.setTransform(d * cos * squash, d * sin * squash, -d * sin, d * cos, d * x, d * y);
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      leafPath(ctx, size, petal);
      ctx.fillStyle = color;
      ctx.fill();
      if (!petal) {
        ctx.beginPath();
        ctx.moveTo(0, -size * 0.5);
        ctx.lineTo(0, size * 0.72);
        ctx.strokeStyle = 'rgba(70, 30, 10, 0.45)';
        ctx.lineWidth = Math.max(0.6, size * 0.06);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    drawDrops() {
      const ctx = this.ctx;
      const size = this.settings.size;
      ctx.lineCap = 'round';
      // Three depth layers: far drops are thin and faint, near ones longer and brighter.
      for (let layer = 0; layer < 3; layer++) {
        let any = false;
        const k = 0.02 + 0.008 * layer; // streak length, in seconds of travel
        for (const p of this.particles) {
          if (p.kind !== DROP || Math.min(2, Math.floor(p.depth * 3)) !== layer) continue;
          if (!any) {
            ctx.beginPath();
            any = true;
          }
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * k, p.y - p.vy * k);
        }
        if (!any) continue;
        ctx.strokeStyle = `rgba(190, 205, 228, ${0.22 + layer * 0.16})`;
        ctx.lineWidth = (0.6 + layer * 0.35) * size;
        ctx.stroke();
      }
    }

    drawBeads() {
      if (!this.beads.length) return;
      const ctx = this.ctx;
      for (const b of this.beads) {
        const rect = this.rectByKey.get(b.key);
        if (!rect) continue;
        const x = rect.x + b.ox;
        const y = rect.y + b.oy;
        if (this.glassAt(x, y) !== rect) continue; // covered by something in front
        if (b.splat) {
          this.drawSplat(x, y, b);
          continue;
        }
        const d = b.r * 3;
        const stretch = b.vy > 5 ? 1.25 : 1; // running drops elongate a little
        ctx.drawImage(this.beadSprite, x - d / 2, y - (d * stretch) / 2, d, d * stretch);
      }
    }

    /** A snowball splat on glass: a lumpy white blob with a little trail where it slid. */
    drawSplat(x, y, b) {
      const ctx = this.ctx;
      const fade = b.life < 8 ? 1 : Math.max(0, (10 - b.life) / 2);
      const k = 1 - Math.min(0.45, b.life * 0.04); // it shrinks as it melts
      const blob = (dx, dy) => {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, b.r * k, 0, TAU);
        for (let i = 0; i < 7; i++) {
          const a = b.seed + i * 0.9;
          const rr = b.r * k * (0.35 + 0.25 * Math.sin(b.seed * 3 + i));
          ctx.moveTo(x + dx + Math.cos(a) * b.r * k * 0.95 + rr, y + dy + Math.sin(a) * b.r * k * 0.95);
          ctx.arc(x + dx + Math.cos(a) * b.r * k * 0.95, y + dy + Math.sin(a) * b.r * k * 0.95, rr, 0, TAU);
        }
        const trailY = y + dy - Math.min(28, b.life * 4);
        ctx.moveTo(x + dx + b.r * 0.3 * k, trailY);
        ctx.arc(x + dx, trailY, b.r * 0.3 * k, 0, TAU);
      };
      ctx.globalAlpha = fade * 0.35;
      ctx.fillStyle = '#1c2a44';
      blob(0, 1.5);
      ctx.fill();
      ctx.globalAlpha = fade;
      ctx.fillStyle = '#f6f9fd';
      blob(0, 0);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    drawBalls() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        if (p.kind !== BALL) continue;
        const grad = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.4, p.r * 0.1, p.x, p.y, p.r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#d4dfec');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, TAU);
        ctx.fill();
      }
    }

    drawSnowmen() {
      const ctx = this.ctx;
      for (const m of this.snowmen) {
        const s = m.surface;
        const x = s.x + m.ox;
        if (!s.visibleAt(x)) continue;
        const base = s.y - s.heightAt(x) + 2;
        const grow = clamp(m.age / 2.2, 0, 1); // it builds itself over ~2 seconds
        const k = m.scale * 1.2 * (1 - 0.3 * m.melt);
        const r1 = 14 * k * clamp(grow / 0.35, 0, 1);
        const r2 = 10 * k * clamp((grow - 0.3) / 0.25, 0, 1);
        const r3 = 7.5 * k * clamp((grow - 0.5) / 0.22, 0, 1);
        const dress = clamp((grow - 0.72) / 0.28, 0, 1);
        const y1 = -r1 * 0.92;
        const y2 = y1 - r1 * 0.78 - r2 * 0.8;
        const y3 = y2 - r2 * 0.78 - r3 * 0.85;

        // Notice the pointer: wave when it comes near, and look at it.
        let wave = 0;
        let lookX = 0;
        let lookY = 0;
        if (this.pointer) {
          const dx = this.pointer.x - x;
          const dy = this.pointer.y - (base + y3);
          wave = Math.max(0, 1 - Math.hypot(dx, dy) / 170);
          lookX = clamp(dx / 160, -1, 1);
          lookY = clamp(dy / 160, -1, 1);
        }
        const tilt = m.melt * 0.3 * m.facing + Math.sin(m.age * 1.3 + m.seed) * 0.012;

        ctx.save();
        ctx.translate(x, base);
        ctx.rotate(tilt);
        ctx.shadowColor = 'rgba(20, 32, 56, 0.3)';
        ctx.shadowBlur = 3 * this.dpr;
        ctx.shadowOffsetY = this.dpr;

        const ball = (cy, r) => {
          if (r <= 0.3) return;
          const grad = ctx.createRadialGradient(-r * 0.35, cy - r * 0.4, r * 0.1, 0, cy, r);
          grad.addColorStop(0, '#ffffff');
          grad.addColorStop(1, '#d6e0ed');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(0, cy, r, 0, TAU);
          ctx.fill();
        };
        ball(y1, r1);
        ball(y2, r2);
        ball(y3, r3);
        ctx.shadowColor = 'transparent';

        if (dress > 0) {
          ctx.globalAlpha = dress;
          ctx.lineCap = 'round';
          // stick arms (the right one waves)
          ctx.strokeStyle = '#6b4325';
          ctx.lineWidth = 1.6 * k;
          const arm = (side, angle) => {
            const sx = side * r2 * 0.85;
            const ex = sx + side * Math.cos(angle) * 14 * k;
            const ey = y2 - Math.sin(angle) * 14 * k;
            ctx.beginPath();
            ctx.moveTo(sx, y2);
            ctx.lineTo(ex, ey);
            ctx.moveTo(sx + side * Math.cos(angle) * 9 * k, y2 - Math.sin(angle) * 9 * k);
            ctx.lineTo(sx + side * Math.cos(angle + 0.7) * 13 * k, y2 - Math.sin(angle + 0.7) * 13 * k);
            ctx.stroke();
          };
          arm(-1, 0.45);
          arm(1, 0.45 + wave * (0.6 + 0.5 * Math.sin(m.age * 12)));
          // coal buttons
          ctx.fillStyle = '#23262e';
          for (const by of [y2 - r2 * 0.25, y2 + r2 * 0.3]) {
            ctx.beginPath();
            ctx.arc(0, by, 1.2 * k, 0, TAU);
            ctx.fill();
          }
          // scarf
          ctx.fillStyle = m.scarf;
          ctx.beginPath();
          ctx.ellipse(0, y2 - r2 * 0.8, r3 * 1.05, 2.2 * k, 0, 0, TAU);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(m.facing * r3 * 0.35, y2 - r2 * 0.8, 3.2 * k, 9 * k, 1.2 * k);
          ctx.fill();
          // eyes (they blink) and a carrot nose, all turned toward the pointer
          const ex = lookX * 1.4 * k;
          const ey = y3 - 1.6 * k + lookY * 1 * k;
          ctx.fillStyle = '#23262e';
          for (const side of [-1, 1]) {
            ctx.beginPath();
            if (m.blink < 0) ctx.ellipse(side * 2.6 * k + ex, ey, 1.2 * k, 0.3 * k, 0, 0, TAU);
            else ctx.arc(side * 2.6 * k + ex, ey, 1.15 * k, 0, TAU);
            ctx.fill();
          }
          const noseDir = Math.abs(lookX) > 0.15 ? Math.sign(lookX) : m.facing;
          ctx.fillStyle = '#f08a24';
          ctx.beginPath();
          ctx.moveTo(ex, y3 + 0.4 * k);
          ctx.lineTo(ex + noseDir * 7 * k, y3 + 1.4 * k);
          ctx.lineTo(ex, y3 + 2.2 * k);
          ctx.closePath();
          ctx.fill();
          // hat
          const top = y3 - r3 * 0.85;
          if (m.hat === 'top') {
            ctx.fillStyle = '#1d2029';
            ctx.fillRect(-8 * k, top - 1.2 * k, 16 * k, 2.4 * k);
            ctx.fillRect(-5.2 * k, top - 10 * k, 10.4 * k, 9 * k);
            ctx.fillStyle = m.scarf;
            ctx.fillRect(-5.2 * k, top - 3.4 * k, 10.4 * k, 1.8 * k);
          } else if (m.hat === 'beanie') {
            ctx.fillStyle = m.scarf;
            ctx.beginPath();
            ctx.ellipse(0, top + 1.5 * k, r3 * 0.95, r3 * 0.75, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, top - r3 * 0.7 + 1 * k, 2.2 * k, 0, TAU);
            ctx.fill();
          }
          ctx.globalAlpha = 1;
        }
        ctx.restore();
      }
    }

    drawFlakes() {
      const ctx = this.ctx;
      const sprite = this.flakeSprite;
      for (const p of this.particles) {
        if (p.kind !== FLAKE && p.kind !== SPRAY) continue;
        const d = p.r * 3.2;
        ctx.globalAlpha = p.kind === SPRAY ? Math.min(1, p.life * 2.5) * (p.water ? 0.7 : 0.9) : p.alpha;
        ctx.drawImage(sprite, p.x - d / 2, p.y - d / 2, d, d);
      }
      ctx.globalAlpha = 1;
    }
  }

  global.Panefall = { Engine, WEATHERS: Object.keys(WEATHERS), DEFAULTS, COL, rand, clamp };
})(window);
