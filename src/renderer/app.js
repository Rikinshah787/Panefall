/*
 * Starts the weather on one display. Inside the app it listens to the main process (display,
 * settings, window positions, the pointer, commands, sound); in a plain browser it runs the
 * fake-desktop demo, where the number keys 1–6 switch weather and M / B / G / T build a
 * snowman, throw a snowball, blow a gust and call thunder.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('weather');
  const engine = new window.Panefall.Engine(canvas);
  const sound = window.PanefallSound ? new window.PanefallSound(engine) : null;
  engine.onEvent = (name, data) => {
    if (sound) sound.event(name, data);
  };
  const fit = () => engine.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  window.addEventListener('resize', fit);
  fit();

  let running = false;
  let last = 0;
  let minFrameMs = 1000 / 60 - 2;
  let displayId = null;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < minFrameMs) return; // caps the frame rate (60 or 30 fps) to save battery
    last = now;
    const dt = Math.min(0.05, elapsed / 1000);
    engine.step(dt);
    engine.draw();
    if (sound) sound.update(dt);
  }

  function setRunning(on) {
    if (on === running) return;
    running = on;
    if (on) {
      last = performance.now();
      requestAnimationFrame(frame);
    } else {
      engine.clearCanvas();
    }
  }

  function run(command, at) {
    switch (command) {
      case 'clear':
        return engine.clearAll();
      case 'plow':
        return engine.plow.trigger();
      case 'snowman':
        return engine.buildSnowman(at);
      case 'snowball':
        return engine.throwSnowball(at);
      case 'gust':
        return engine.gust();
      case 'thunder':
        return engine.thunder();
      default:
        return undefined;
    }
  }

  // Play mode: reach into the weather. Drag to sweep, flick to throw, double-click for a snowman.
  let playing = false;
  let stroke = null;
  function setPlay(on) {
    playing = on;
    document.body.classList.toggle('play', on);
    stroke = null;
  }
  canvas.addEventListener('pointerdown', (event) => {
    if (!playing) return;
    canvas.setPointerCapture(event.pointerId);
    stroke = { samples: [[event.clientX, event.clientY, performance.now()]], travelled: 0 };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!playing || !stroke) return;
    const [lx, ly] = stroke.samples[stroke.samples.length - 1];
    const dx = event.clientX - lx;
    const dy = event.clientY - ly;
    stroke.travelled += Math.hypot(dx, dy);
    stroke.samples.push([event.clientX, event.clientY, performance.now()]);
    if (stroke.samples.length > 6) stroke.samples.shift();
    engine.brush(event.clientX, event.clientY, dx, dy);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!playing || !stroke) return;
    const [fx, fy, ft] = stroke.samples[0];
    const seconds = Math.max(0.016, (performance.now() - ft) / 1000);
    const vx = (event.clientX - fx) / seconds;
    const vy = (event.clientY - fy) / seconds;
    if (stroke.travelled > 30 && Math.hypot(vx, vy) > 650) engine.throwFrom(event.clientX, event.clientY, vx * 0.9, vy * 0.9);
    stroke = null;
  });
  canvas.addEventListener('dblclick', (event) => {
    if (playing) engine.buildSnowman({ x: event.clientX, y: event.clientY });
  });

  // Handy for debugging from DevTools.
  window.panefallEngine = engine;
  window.panefallSetPlay = setPlay;

  const bridge = window.panefall;
  if (bridge && bridge.onSettings) {
    bridge.onDisplay((display) => {
      displayId = display.id;
      engine.setOrigin(display.bounds.x, display.bounds.y);
      fit();
    });
    bridge.onSettings((settings) => {
      engine.setSettings(settings);
      minFrameMs = 1000 / (settings.fps || 60) - 2;
      setRunning(!settings.paused);
    });
    bridge.onWindows((report) => engine.setWindows(report));
    bridge.onPointer((point) => {
      // Global screen point -> this display's coordinates.
      engine.setPointer(point ? { x: point.x - engine.origin.x, y: point.y - engine.origin.y } : null);
    });
    bridge.onCommand((message) => {
      const command = typeof message === 'string' ? { name: message } : message;
      if (command.displayId !== undefined && command.displayId !== displayId) return; // meant for another display
      const at = command.at ? { x: command.at.x - engine.origin.x, y: command.at.y - engine.origin.y } : null;
      run(command.name, at);
    });
    if (bridge.onSound) bridge.onSound((config) => sound && sound.configure(config));
    if (bridge.onPlay) bridge.onPlay(setPlay);
  } else {
    window.PanefallDemo.start(engine);
    let pointer = null;
    window.addEventListener('pointermove', (event) => {
      pointer = { x: event.clientX, y: event.clientY };
      engine.setPointer(pointer);
    });
    document.addEventListener('pointerleave', () => engine.setPointer((pointer = null)));
    const keys = { m: 'snowman', b: 'snowball', g: 'gust', t: 'thunder', p: 'plow', c: 'clear' };
    window.addEventListener('keydown', (event) => {
      const weather = window.Panefall.WEATHERS[Number(event.key) - 1];
      if (weather) engine.setSettings({ weather });
      else if (keys[event.key]) run(keys[event.key], pointer);
    });
    setRunning(true);
  }
})();
