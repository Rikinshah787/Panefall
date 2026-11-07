/*
 * Renders the animated demo at the top of the README (docs/assets/demo.gif) frame by frame
 * with the real weather engine, on a little drawn desktop. The timeline is fixed: snow has
 * piled up on two windows, a pointer drags one away (its snow tumbles off), shelters in the
 * open under its umbrella, then drags the window back, so the GIF loops.
 *
 * To regenerate the GIF:
 *   1. npm run demo, then open http://127.0.0.1:4321/scripts/demo-recorder.html
 *   2. In the DevTools console:  copy(JSON.stringify(panefallRecorder.all()))
 *      and paste the clipboard into a file, e.g. /tmp/frames.json
 *   3. swift scripts/frames-to-gif.swift /tmp/frames.json docs/assets/demo.gif
 */
(function () {
  'use strict';

  // ?scene=snowman renders docs/assets/snowman.gif instead (a snowman builds itself, waves at
  // the pointer, a snowball splats on the other window, then the window is dragged away).
  const SCENE = new URLSearchParams(window.location.search).get('scene') || 'drag';
  const W = 720;
  const H = 405;
  const FPS = 15;
  const SECONDS = SCENE === 'snowman' ? 6 : 5;
  const FRAMES = FPS * SECONDS;
  const MENUBAR = 24;

  const canvas = document.getElementById('frame');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const layer = document.createElement('canvas');
  const engine = new window.Panefall.Engine(layer);
  engine.resize(W, H, 1);
  engine.setSettings({ weather: 'snow', intensity: 0.6, wind: 0.12, depth: 0.62, collectOnDock: false });

  // Two windows; "notes" (in front) is the one that gets dragged.
  const notes = { id: 1, title: 'Notes', dark: false, x: 60, y: 118, w: 300, h: 200 };
  const photos = { id: 2, title: 'Photos', dark: true, x: 418, y: 172, w: 250, h: 170 };
  const HOME = { x: notes.x, y: notes.y };
  const AWAY = { x: notes.x + 180, y: notes.y - 36 };
  const GRAB = { x: 150, y: 13 }; // where the pointer holds the title bar
  const SKY = { x: 150, y: 62 };

  const ease = (t) => (t < 0 ? 0 : t > 1 ? 1 : t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (p, q, t) => ({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
  const along = (t, t0, t1) => ease((t - t0) / (t1 - t0));

  /** Window position and pointer position at time t (seconds). */
  function timeline(t) {
    const atHome = { x: HOME.x + GRAB.x, y: HOME.y + GRAB.y };
    const atAway = { x: AWAY.x + GRAB.x, y: AWAY.y + GRAB.y };
    let win = HOME;
    let pointer = atHome;
    if (t >= 0.5 && t < 1.4) {
      win = mix(HOME, AWAY, along(t, 0.5, 1.4)); // drag away: the snow tumbles off
      pointer = { x: win.x + GRAB.x, y: win.y + GRAB.y };
    } else if (t >= 1.4 && t < 2.0) {
      win = AWAY;
      pointer = mix(atAway, SKY, along(t, 1.4, 2.0)); // into the open, under the umbrella
    } else if (t >= 2.0 && t < 3.4) {
      win = AWAY;
      const wobble = Math.sin((t - 2.0) * 2.2) * 14;
      pointer = { x: SKY.x + wobble, y: SKY.y + Math.sin((t - 2.0) * 3.1) * 4 };
    } else if (t >= 3.4 && t < 3.9) {
      win = AWAY;
      pointer = mix({ x: SKY.x + Math.sin(1.4 * 2.2) * 14, y: SKY.y }, atAway, along(t, 3.4, 3.9));
    } else if (t >= 3.9 && t < 4.7) {
      win = mix(AWAY, HOME, along(t, 3.9, 4.7)); // and back again, so the GIF loops
      pointer = { x: win.x + GRAB.x, y: win.y + GRAB.y };
    }
    return { win, pointer };
  }

  const SNOWMAN_X = HOME.x + 175;

  function snowmanTimeline(t) {
    const atHome = { x: HOME.x + GRAB.x, y: HOME.y + GRAB.y };
    const start = { x: 640, y: 360 };
    const near = { x: SNOWMAN_X + 52, y: HOME.y - 44 };
    const photo = { x: photos.x + 125, y: photos.y + 95 };
    const wobble = (s) => ({ x: Math.sin(s * 2.4) * 10, y: Math.sin(s * 3.3) * 5 });
    let win = HOME;
    let pointer = start;
    if (t < 1.4) pointer = mix(start, near, along(t, 0, 1.4));
    else if (t < 2.6) pointer = { x: near.x + wobble(t - 1.4).x, y: near.y + wobble(t - 1.4).y };
    else if (t < 2.9) pointer = mix(near, photo, along(t, 2.6, 2.9));
    else if (t < 3.6) pointer = photo;
    else if (t < 4.1) pointer = mix(photo, atHome, along(t, 3.6, 4.1));
    else if (t < 4.8) {
      win = mix(HOME, AWAY, along(t, 4.1, 4.8)); // the snowman tumbles off
      pointer = { x: win.x + GRAB.x, y: win.y + GRAB.y };
    } else if (t < 5.2) {
      win = AWAY;
      pointer = { x: AWAY.x + GRAB.x, y: AWAY.y + GRAB.y };
    } else {
      win = mix(AWAY, HOME, along(t, 5.2, 5.9));
      pointer = { x: win.x + GRAB.x, y: win.y + GRAB.y };
    }
    return { win, pointer };
  }

  const ACTIONS =
    SCENE === 'snowman'
      ? [
          [
            0.1,
            () => {
              engine.buildSnowman({ x: SNOWMAN_X, y: HOME.y + 60 });
              engine.snowmen[engine.snowmen.length - 1].scale = 1.5; // a bit bigger, to read at GIF size
            },
          ],
          [2.9, () => engine.throwSnowball({ x: photos.x + 125, y: photos.y + 95 })],
        ]
      : [];

  // ------------------------------------------------------------ drawing

  const background = document.createElement('canvas');
  background.width = W;
  background.height = H;
  (function paintBackground() {
    const g = background.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0b1029');
    sky.addColorStop(0.55, '#1a2352');
    sky.addColorStop(1, '#3b3f7a');
    g.fillStyle = sky;
    g.fillRect(0, 0, W, H);
    const glow = g.createRadialGradient(W * 0.8, -40, 0, W * 0.8, -40, 420);
    glow.addColorStop(0, 'rgba(126,146,255,0.28)');
    glow.addColorStop(1, 'rgba(126,146,255,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, W, H);
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(255,255,255,${0.15 + random() * 0.4})`;
      g.fillRect(random() * W, random() * H * 0.6, 1.2, 1.2);
    }
    g.fillStyle = 'rgba(10,14,36,0.62)';
    g.fillRect(0, 0, W, MENUBAR);
    g.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    g.fillStyle = 'rgba(238,241,255,0.9)';
    g.fillText('Panefall', 14, 16);
    g.fillStyle = 'rgba(238,241,255,0.7)';
    g.fillText('−2°', W - 34, 16);
  })();

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  function drawWindow(w) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    roundRect(w.x, w.y, w.w, w.h, 10);
    ctx.fillStyle = w.dark ? '#24262f' : '#f6f5f1';
    ctx.fill();
    ctx.restore();

    ctx.save();
    roundRect(w.x, w.y, w.w, w.h, 10);
    ctx.clip();
    ctx.fillStyle = w.dark ? '#2e313d' : '#e9e7e1';
    ctx.fillRect(w.x, w.y, w.w, 26);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
      ctx.beginPath();
      ctx.arc(w.x + 15 + i * 15, w.y + 13, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    });
    ctx.font = '600 12px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = w.dark ? '#c9cee0' : '#4a4f60';
    ctx.fillText(w.title, w.x + 64, w.y + 17);
    ctx.fillStyle = w.dark ? 'rgba(255,255,255,0.09)' : 'rgba(23,26,40,0.08)';
    const widths = [0.62, 0.8, 0.5, 0.72, 0.4, 0.66];
    widths.forEach((f, i) => {
      if (46 + i * 22 > w.h - 16) return;
      roundRect(w.x + 20, w.y + 46 + i * 22, (w.w - 40) * f, 8, 4);
      ctx.fill();
    });
    ctx.restore();
  }

  function drawPointer(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    const pts = [
      [0, 0],
      [0, 16],
      [4, 12.5],
      [6.8, 18.8],
      [9.2, 17.8],
      [6.5, 11.6],
      [11.5, 11.6],
    ];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#111';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------ simulation

  function reportWindows() {
    engine.setWindows({
      windows: [notes, photos].map(({ id, x, y, w, h }) => ({ id, x: Math.round(x), y: Math.round(y), w, h })),
      menubars: [{ x: 0, y: 0, w: W, h: MENUBAR }],
      dock: null,
    });
  }

  reportWindows();
  for (let i = 0; i < 100 * 30; i++) engine.step(1 / 30); // let the snow pile up first

  let next = 0;
  function renderFrame() {
    const t = next / FPS;
    const { win, pointer } = SCENE === 'snowman' ? snowmanTimeline(t) : timeline(t);
    for (const [at, action] of ACTIONS) if (at >= t && at < t + 1 / FPS) action();
    notes.x = win.x;
    notes.y = win.y;
    reportWindows();
    engine.setPointer(pointer);
    engine.step(1 / 30);
    engine.step(1 / 30);
    engine.draw();
    ctx.drawImage(background, 0, 0);
    drawWindow(photos);
    drawWindow(notes);
    ctx.drawImage(layer, 0, 0, W, H);
    drawPointer(pointer);
    next++;
    return canvas.toDataURL('image/png');
  }

  window.panefallRecorder = {
    frames: FRAMES,
    fps: FPS,
    /** The next `count` frames as PNG data URLs (frames must be taken in order). */
    take(count) {
      const out = [];
      for (let i = 0; i < count && next < FRAMES; i++) out.push(renderFrame());
      return out;
    },
    all() {
      return this.take(FRAMES - next);
    },
  };
})();
