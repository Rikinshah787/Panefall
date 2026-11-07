/*
 * Panefall website. Runs the app's real weather engine (engine/sim.js, copied in by
 * `npm run site`):
 *   - over the hero, where the two windows act as desktop windows you can drag, and the
 *     mouse pointer is an umbrella the weather parts around;
 *   - in a tiny live scene at the top of each weather card.
 * Only scenes that are on screen animate. Sections fade up as they scroll into view.
 */
(function () {
  'use strict';

  // Your GitHub repository. Every link marked [data-repo] is built from it.
  const REPO = 'https://github.com/Rikinshah787/Panefall';
  for (const link of document.querySelectorAll('[data-repo]')) link.href = REPO + link.dataset.repo;

  const { Engine } = window.Panefall;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  const scenes = []; // { engine, el, visible, live? }

  function settle(engine, seconds) {
    // Simulate ahead so a scene starts with weather already collected on its windows.
    for (let i = 0; i < seconds * 30; i++) engine.step(1 / 30);
    engine.draw();
  }

  // ------------------------------------------------------------ hero

  const hero = document.querySelector('.hero');
  const desk = hero.querySelector('.desk');
  const menubar = hero.querySelector('.menubar');
  const windows = [...desk.querySelectorAll('.win')];
  const heroEngine = new Engine(document.getElementById('weather'));

  const HERO_INTENSITY = { snow: 0.42, rain: 0.55, storm: 0.5, leaves: 0.6, blossoms: 0.5 };
  heroEngine.setSettings({
    weather: 'snow',
    intensity: reduceMotion ? 0.12 : HERO_INTENSITY.snow,
    wind: 0.2,
    depth: 0.55,
    lightning: !reduceMotion,
    collectOnDock: false,
  });
  scenes.push({ engine: heroEngine, el: hero, visible: true });

  let z = 10;
  for (const win of windows) win.style.zIndex = String(++z);

  function relativeTo(container, el) {
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left - c.left), y: Math.round(r.top - c.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function report() {
    const frontToBack = [...windows].sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    heroEngine.setWindows({
      windows: frontToBack.map((win) => ({ id: Number(win.dataset.id), ...relativeTo(hero, win) })),
      menubars: [relativeTo(hero, menubar)],
      dock: null,
    });
  }

  // Wide screens: the windows float on the "desktop" and can be dragged.
  // Narrow screens: they stack like a normal page.
  let free = false;

  function layout() {
    const wantFree = window.innerWidth >= 900;
    if (wantFree !== free) {
      free = wantFree;
      desk.classList.toggle('free', free);
      if (free) placeWindows();
      else for (const win of windows) win.style.left = win.style.top = '';
    } else if (free) {
      keepInside();
    }
  }

  function placeWindows() {
    const W = desk.clientWidth;
    const H = desk.clientHeight;
    const [main, tryIt] = windows;
    main.style.left = `${Math.round(W * 0.08)}px`;
    main.style.top = `${Math.round(Math.max(48, H * 0.13))}px`;
    tryIt.style.left = `${Math.round(W - tryIt.offsetWidth - W * 0.07)}px`;
    tryIt.style.top = `${Math.round(H * 0.5)}px`;
  }

  function keepInside() {
    for (const win of windows) {
      const x = Math.min(Math.max(80 - win.offsetWidth, win.offsetLeft), desk.clientWidth - 80);
      const y = Math.min(Math.max(0, win.offsetTop), desk.clientHeight - 60);
      win.style.left = `${x}px`;
      win.style.top = `${y}px`;
    }
  }

  for (const win of windows) {
    const bar = win.querySelector('.bar');
    win.addEventListener('animationend', report); // the entrance animation moved it
    win.addEventListener('pointerdown', () => {
      win.style.zIndex = String(++z);
      report();
    });
    bar.addEventListener('pointerdown', (down) => {
      if (!free) return;
      down.preventDefault();
      bar.setPointerCapture(down.pointerId);
      win.classList.add('dragging');
      const dx = down.clientX - win.offsetLeft;
      const dy = down.clientY - win.offsetTop;
      const move = (event) => {
        win.style.left = `${event.clientX - dx}px`;
        win.style.top = `${Math.max(0, event.clientY - dy)}px`;
        report();
      };
      const up = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', up);
        bar.removeEventListener('pointercancel', up);
        win.classList.remove('dragging');
        keepInside();
        report();
      };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
      bar.addEventListener('pointercancel', up);
    });
  }

  // The pointer is an umbrella.
  hero.addEventListener('pointermove', (event) => {
    const r = hero.getBoundingClientRect();
    heroEngine.setPointer({ x: event.clientX - r.left, y: event.clientY - r.top });
  });
  hero.addEventListener('pointerleave', () => heroEngine.setPointer(null));

  const chips = [...document.querySelectorAll('[data-weather]')];
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const weather = chip.dataset.weather;
      heroEngine.setSettings({ weather, intensity: reduceMotion ? 0.12 : HERO_INTENSITY[weather] });
      for (const other of chips) other.setAttribute('aria-pressed', String(other === chip));
    });
  }
  document.getElementById('sweep').addEventListener('click', () => heroEngine.clearAll());
  const toys = {
    snowman: () => heroEngine.buildSnowman(null),
    snowball: () => heroEngine.throwSnowball(null),
    gust: () => heroEngine.gust(),
  };
  for (const button of document.querySelectorAll('[data-toy]')) button.addEventListener('click', () => toys[button.dataset.toy]());

  function fitHero() {
    layout();
    const r = hero.getBoundingClientRect();
    heroEngine.resize(Math.round(r.width), Math.round(r.height), dpr());
    report();
  }
  new ResizeObserver(fitHero).observe(hero);
  if (document.fonts) document.fonts.ready.then(fitHero); // the headline font changes window sizes
  fitHero();

  // ------------------------------------------------------------ mini scenes in the cards

  const MINI = {
    snow: { intensity: 0.8, wind: 0.2 },
    rain: { intensity: 0.65, wind: 0.25 },
    storm: { intensity: 0.45, wind: 0.5 },
    leaves: { intensity: 1, wind: 0.3 },
    blossoms: { intensity: 1, wind: 0.25 },
  };
  const LIVE = [
    ['rain', 'Live · Light rain'],
    ['snow', 'Live · Snow showers'],
    ['leaves', 'Live · Dry autumn day'],
  ];

  for (const box of document.querySelectorAll('.mini')) {
    const engine = new Engine(box.querySelector('canvas'));
    const win = box.querySelector('.mini-win');
    const live = box.dataset.scene === 'live';
    const scene = { engine, el: box, visible: false, live, liveIndex: 0, liveTime: 0, tag: box.querySelector('.mini-tag') };
    const kind = live ? LIVE[0][0] : box.dataset.scene;

    scene.fit = () => {
      const r = box.getBoundingClientRect();
      if (!r.width) return;
      engine.resize(Math.round(r.width), Math.round(r.height), dpr());
      engine.setWindows({ windows: [{ id: 1, ...relativeTo(box, win) }], menubars: [], dock: null });
    };
    engine.setSettings({ weather: kind, ...MINI[kind], depth: 0.45, plow: false, lightning: !reduceMotion });
    scene.fit();
    settle(engine, 40);
    if (scene.tag) scene.tag.textContent = LIVE[0][1];

    box.addEventListener('pointermove', (event) => {
      const r = box.getBoundingClientRect();
      engine.setPointer({ x: event.clientX - r.left, y: event.clientY - r.top });
    });
    box.addEventListener('pointerleave', () => engine.setPointer(null));
    new ResizeObserver(scene.fit).observe(box);
    scenes.push(scene);
  }

  // The "Live weather" card cycles through a few conditions.
  function cycleLive(scene, dt) {
    scene.liveTime += dt;
    if (scene.liveTime < 7) return;
    scene.liveTime = 0;
    scene.liveIndex = (scene.liveIndex + 1) % LIVE.length;
    const [weather, label] = LIVE[scene.liveIndex];
    scene.engine.setSettings({ weather, ...MINI[weather] });
    scene.tag.style.opacity = '0';
    setTimeout(() => {
      scene.tag.textContent = label;
      scene.tag.style.opacity = '1';
    }, 300);
  }

  // ------------------------------------------------------------ one loop for every scene

  const byElement = new Map(scenes.map((s) => [s.el, s]));
  const watcher = new IntersectionObserver((entries) => {
    for (const entry of entries) byElement.get(entry.target).visible = entry.isIntersecting;
  });
  for (const scene of scenes) watcher.observe(scene.el);

  let running = false;
  let last = 0;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < 14) return; // ~60 fps on 120 Hz displays
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    for (const scene of scenes) {
      if (!scene.visible) continue;
      if (scene.live) cycleLive(scene, dt);
      scene.engine.step(dt);
      scene.engine.draw();
    }
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) {
      last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  setRunning(!document.hidden);

  // ------------------------------------------------------------ scroll reveal

  if (!reduceMotion && 'IntersectionObserver' in window) {
    const targets = document.querySelectorAll(
      '.section .kicker, .section h2, .section-lede, .card, .steps li, .ticks, .shot, .shortcut-box, .oss .ctas',
    );
    for (const grid of document.querySelectorAll('.cards, .steps')) {
      [...grid.children].forEach((child, i) => child.style.setProperty('--delay', `${(i % 3) * 90}ms`));
    }
    const reveal = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in');
          reveal.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    for (const el of targets) {
      el.classList.add('reveal');
      reveal.observe(el);
    }
  }

  // Handy for screenshots and debugging.
  window.panefallEngine = heroEngine;
  window.panefallScenes = scenes;
})();
