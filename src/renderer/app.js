/*
 * Starts the weather. Inside the app it listens to the main process (display, settings,
 * window positions, commands); in a plain browser it runs the fake-desktop demo, where the
 * number keys 1–6 switch weather.
 */
(function () {
  'use strict';

  const canvas = document.getElementById('weather');
  const engine = new window.Panefall.Engine(canvas);
  const fit = () => engine.resize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
  window.addEventListener('resize', fit);
  fit();

  let running = false;
  let last = 0;
  let minFrameMs = 1000 / 60 - 2;

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const elapsed = now - last;
    if (elapsed < minFrameMs) return; // caps the frame rate (60 or 30 fps) to save battery
    last = now;
    engine.step(Math.min(0.05, elapsed / 1000));
    engine.draw();
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

  // Handy for debugging from DevTools.
  window.panefallEngine = engine;

  const bridge = window.panefall;
  if (bridge && bridge.onSettings) {
    bridge.onDisplay((display) => {
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
    bridge.onCommand((command) => {
      if (command === 'clear') engine.clearAll();
      else if (command === 'plow') engine.plow.trigger();
    });
  } else {
    window.PanefallDemo.start(engine);
    window.addEventListener('pointermove', (event) => engine.setPointer({ x: event.clientX, y: event.clientY }));
    document.addEventListener('pointerleave', () => engine.setPointer(null));
    window.addEventListener('keydown', (event) => {
      const weather = window.Panefall.WEATHERS[Number(event.key) - 1];
      if (weather) engine.setSettings({ weather });
    });
    setRunning(true);
  }
})();
