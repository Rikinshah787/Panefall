/*
 * Browser demo: when the page runs outside Electron, build a fake desktop (menu bar,
 * three draggable windows, a dock) and feed their positions to the simulation exactly
 * like the native window tracker would.
 */
(function (global) {
  'use strict';

  const WINDOWS = [
    { title: 'Notes', theme: 'light', x: 0.07, y: 0.22, w: 0.3, h: 0.36 },
    { title: 'Photos', theme: 'dark', x: 0.43, y: 0.34, w: 0.34, h: 0.4 },
    { title: 'Music', theme: 'light', x: 0.63, y: 0.13, w: 0.24, h: 0.22 },
  ];
  const DOCK_COLORS = ['#3b82f6', '#9ca3af', '#f59e0b', '#22c55e', '#ef4444', '#a855f7'];

  function el(tag, className, parent) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    (parent || document.body).appendChild(node);
    return node;
  }

  function rectOf(node) {
    const r = node.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  }

  function start(snow) {
    document.body.classList.add('demo');
    const menubar = el('div', 'demo-menubar');
    const dock = el('div', 'demo-dock');
    for (const color of DOCK_COLORS) el('i', '', dock).style.background = color;

    let z = 10;
    const windows = WINDOWS.map((spec, i) => {
      const win = el('div', `demo-window ${spec.theme}`);
      const bar = el('div', 'bar', win);
      el('i', '', bar);
      el('i', '', bar);
      el('i', '', bar);
      el('b', '', bar).textContent = spec.title;
      win.dataset.id = String(i + 1);
      win.style.left = `${Math.round(spec.x * innerWidth)}px`;
      win.style.top = `${Math.round(spec.y * innerHeight)}px`;
      win.style.width = `${Math.round(spec.w * innerWidth)}px`;
      win.style.height = `${Math.round(spec.h * innerHeight)}px`;
      win.style.zIndex = String(++z);

      win.addEventListener('pointerdown', (down) => {
        win.style.zIndex = String(++z);
        win.setPointerCapture(down.pointerId);
        const startX = down.clientX - win.offsetLeft;
        const startY = down.clientY - win.offsetTop;
        const move = (e) => {
          win.style.left = `${e.clientX - startX}px`;
          win.style.top = `${Math.max(26, e.clientY - startY)}px`;
          report();
        };
        const up = () => {
          win.removeEventListener('pointermove', move);
          win.removeEventListener('pointerup', up);
          report();
        };
        win.addEventListener('pointermove', move);
        win.addEventListener('pointerup', up);
        report();
      });
      return win;
    });

    function report() {
      const frontToBack = [...windows].sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
      snow.setWindows({
        windows: frontToBack.map((w) => ({ id: Number(w.dataset.id), ...rectOf(w) })),
        menubars: [rectOf(menubar)],
        dock: rectOf(dock),
        accessibility: true,
      });
    }

    addEventListener('resize', report);
    report();
    return { report };
  }

  global.PanefallDemo = { start };
})(window);
