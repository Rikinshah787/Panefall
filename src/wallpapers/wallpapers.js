/*
 * Panefall wallpapers, painted in code so they're crisp at any size: the Golden Gate Bridge in
 * snow, at dawn, in fog and at autumn dusk, and snowy peaks under an aurora.
 *   PanefallWallpapers.list                        -> [{ id, name }]
 *   PanefallWallpapers.draw(canvas, id, w, h)      -> paints it on a canvas of w×h pixels
 */
(function (global) {
  'use strict';

  const LIST = [
    { id: 'gg-snow-night', name: 'Golden Gate · Snowy Night' },
    { id: 'gg-snow-dawn', name: 'Golden Gate · Snowy Dawn' },
    { id: 'gg-fog', name: 'Golden Gate · Fog' },
    { id: 'gg-autumn', name: 'Golden Gate · Autumn Dusk' },
    { id: 'aurora', name: 'Snowy Peaks & Aurora' },
  ];

  const LOOKS = {
    'gg-snow-night': { sky: ['#0a1030', '#1b2558', '#3a3f7c'], hill: '#1a2347', near: '#121a38', water: ['#16204a', '#0a1026'], bridge: '#9c3329', snow: true, stars: true, moon: true, lights: true },
    'gg-snow-dawn': { sky: ['#3b4f9a', '#c78bb5', '#ffc9a6'], hill: '#5b5f95', near: '#3f4478', water: ['#8f8fbf', '#4b5590'], bridge: '#c7402f', snow: true, sun: '#ffe3c0' },
    'gg-fog': { sky: ['#8ea2bf', '#b9c7d8', '#dce3ea'], hill: '#7d8fa8', near: '#66788f', water: ['#9fb0c3', '#73869c'], bridge: '#b9483a', fog: true },
    'gg-autumn': { sky: ['#2b2152', '#b8526a', '#ffb067'], hill: '#4a2d4a', near: '#341f38', water: ['#8a4f6b', '#2f2140'], bridge: '#c2402c', sun: '#ffd28a', lights: true },
  };

  // Small seeded random so a wallpaper looks the same every time.
  function seeded(seed) {
    let s = seed;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }

  function sky(g, w, h, colors, horizon) {
    const grad = g.createLinearGradient(0, 0, 0, horizon);
    colors.forEach((c, i) => grad.addColorStop(i / (colors.length - 1), c));
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }

  /** A ridge line of soft hills; optionally with snow along the top. */
  function hills(g, w, base, height, color, seed, snow) {
    const random = seeded(seed);
    const phases = [random() * 6, random() * 6, random() * 6];
    const ridge = [];
    for (let i = 0; i <= 120; i++) {
      const x = (i / 120) * w;
      const t = i / 120;
      const taper = Math.min(1, (1 - t) * 4); // slope down into the water at the right end
      const y = base - height * taper * (0.55 + 0.25 * Math.sin(t * 5 + phases[0]) + 0.15 * Math.sin(t * 13 + phases[1]) + 0.05 * Math.sin(t * 31 + phases[2]));
      ridge.push([x, y]);
    }
    g.beginPath();
    g.moveTo(0, base + 2);
    for (const [x, y] of ridge) g.lineTo(x, y);
    g.lineTo(w, base + 2);
    g.closePath();
    g.fillStyle = color;
    g.fill();
    if (!snow) return;
    g.beginPath();
    ridge.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    for (let i = ridge.length - 1; i >= 0; i--) {
      const [x, y] = ridge[i];
      g.lineTo(x, y + height * (0.12 + 0.1 * Math.abs(Math.sin(i * 0.7 + phases[0]))));
    }
    g.closePath();
    const white = g.createLinearGradient(0, base - height, 0, base);
    white.addColorStop(0, '#ffffff');
    white.addColorStop(1, '#c9d6ea');
    g.fillStyle = white;
    g.fill();
  }

  function water(g, w, h, horizon, colors, random) {
    const grad = g.createLinearGradient(0, horizon, 0, h);
    grad.addColorStop(0, colors[0]);
    grad.addColorStop(1, colors[1]);
    g.fillStyle = grad;
    g.fillRect(0, horizon, w, h - horizon);
    g.strokeStyle = 'rgba(255,255,255,0.08)';
    g.lineWidth = Math.max(1, h * 0.0015);
    for (let i = 0; i < 70; i++) {
      const y = horizon + Math.pow(random(), 1.6) * (h - horizon);
      const x = random() * w;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + w * (0.01 + random() * 0.05), y);
      g.stroke();
    }
  }

  function bridge(g, w, h, look, deckY) {
    const color = look.bridge;
    const towers = [w * 0.3, w * 0.8];
    const towerTop = h * 0.22;
    const tw = w * 0.024;
    const cable = (x0, y0, x1, y1, sag) => (t) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t + sag * 4 * t * (1 - t)];
    const spans = [
      cable(-w * 0.1, deckY - h * 0.01, towers[0], towerTop + h * 0.01, h * 0.1),
      cable(towers[0], towerTop + h * 0.01, towers[1], towerTop + h * 0.01, deckY - towerTop - h * 0.03),
      cable(towers[1], towerTop + h * 0.01, w * 1.1, deckY - h * 0.02, h * 0.1),
    ];

    // Suspender ropes, then the main cables (with snow along their tops).
    g.strokeStyle = color;
    g.globalAlpha = 0.75;
    g.lineWidth = Math.max(1, w * 0.0007);
    for (const span of spans) {
      for (let t = 0.02; t < 1; t += 0.018) {
        const [x, y] = span(t);
        if (x < 0 || x > w) continue;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, deckY);
        g.stroke();
      }
    }
    g.globalAlpha = 1;
    for (const span of spans) {
      g.beginPath();
      for (let t = 0; t <= 1.0001; t += 0.01) {
        const [x, y] = span(t);
        if (t === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.lineWidth = Math.max(2, w * 0.0028);
      g.strokeStyle = color;
      g.stroke();
      if (look.snow) {
        g.lineWidth = Math.max(1, w * 0.0012);
        g.strokeStyle = 'rgba(255,255,255,0.9)';
        g.save();
        g.translate(0, -w * 0.0014);
        g.stroke();
        g.restore();
      }
    }

    // Towers: an art-deco shape with four portals and a stepped crown, snow on every ledge.
    for (const cx of towers) {
      g.fillStyle = color;
      g.beginPath();
      g.moveTo(cx - tw * 0.62, deckY + h * 0.06);
      g.lineTo(cx - tw * 0.5, towerTop);
      g.lineTo(cx + tw * 0.5, towerTop);
      g.lineTo(cx + tw * 0.62, deckY + h * 0.06);
      g.closePath();
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.28)';
      for (let i = 0; i < 4; i++) {
        const y = towerTop + (deckY - towerTop) * (0.08 + i * 0.24);
        g.fillRect(cx - tw * 0.28, y, tw * 0.56, (deckY - towerTop) * 0.12);
      }
      g.fillStyle = color;
      g.fillRect(cx - tw * 0.36, towerTop - h * 0.012, tw * 0.72, h * 0.014);
      if (look.snow) {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.ellipse(cx, towerTop - h * 0.012, tw * 0.48, h * 0.009, 0, Math.PI, 0);
        g.fill();
        for (let i = 0; i < 4; i++) {
          const y = towerTop + (deckY - towerTop) * (0.08 + i * 0.24);
          g.fillRect(cx - tw * 0.3, y - h * 0.004, tw * 0.6, h * 0.004);
        }
      }
    }

    // The deck, its truss, snow on top and lights.
    const deckH = h * 0.014;
    g.fillStyle = color;
    g.fillRect(0, deckY, w, deckH);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.fillRect(0, deckY + deckH * 0.6, w, deckH * 0.4);
    if (look.snow) {
      g.fillStyle = '#f4f8ff';
      g.fillRect(0, deckY - h * 0.004, w, h * 0.005);
    }
    if (look.lights) {
      for (let x = w * 0.005; x < w; x += w * 0.012) {
        const glow = g.createRadialGradient(x, deckY, 0, x, deckY, h * 0.012);
        glow.addColorStop(0, 'rgba(255,214,140,0.95)');
        glow.addColorStop(1, 'rgba(255,214,140,0)');
        g.fillStyle = glow;
        g.fillRect(x - h * 0.012, deckY - h * 0.012, h * 0.024, h * 0.024);
      }
    }
  }

  function goldenGate(g, w, h, look) {
    const random = seeded(17);
    const horizon = h * 0.66;
    sky(g, w, h, look.sky, horizon);
    if (look.stars) {
      for (let i = 0; i < 220; i++) {
        g.fillStyle = `rgba(255,255,255,${0.2 + random() * 0.6})`;
        const s = random() * h * 0.0016 + 0.5;
        g.fillRect(random() * w, random() * horizon * 0.8, s, s);
      }
    }
    if (look.moon || look.sun) {
      const [mx, my, r] = look.moon ? [w * 0.84, h * 0.13, h * 0.035] : [w * 0.62, horizon - h * 0.08, h * 0.06];
      const glow = g.createRadialGradient(mx, my, 0, mx, my, r * 6);
      glow.addColorStop(0, look.moon ? 'rgba(255,240,210,0.35)' : 'rgba(255,230,190,0.6)');
      glow.addColorStop(1, 'rgba(255,240,210,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, w, h);
      g.fillStyle = look.moon ? '#fff4dc' : look.sun;
      g.beginPath();
      g.arc(mx, my, r, 0, Math.PI * 2);
      g.fill();
    }
    hills(g, w, horizon, h * 0.2, look.hill, 3, look.snow);
    water(g, w, h, horizon, look.water, random);
    hills(g, w * 0.45, horizon + h * 0.02, h * 0.09, look.near, 9, look.snow);
    bridge(g, w, h, look, horizon - h * 0.07);
    if (look.fog) {
      for (let i = 0; i < 3; i++) {
        const y = horizon - h * (0.12 - i * 0.07);
        const fog = g.createLinearGradient(0, y - h * 0.08, 0, y + h * 0.1);
        fog.addColorStop(0, 'rgba(236,240,245,0)');
        fog.addColorStop(0.5, 'rgba(236,240,245,0.82)');
        fog.addColorStop(1, 'rgba(236,240,245,0)');
        g.fillStyle = fog;
        g.fillRect(0, y - h * 0.08, w, h * 0.18);
      }
    }
    if (look.snow) {
      for (let i = 0; i < 420; i++) {
        g.fillStyle = `rgba(255,255,255,${0.35 + random() * 0.55})`;
        g.beginPath();
        g.arc(random() * w, random() * h, (random() * 1.6 + 0.4) * h * 0.0018, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  function aurora(g, w, h) {
    const random = seeded(5);
    const horizon = h * 0.72;
    sky(g, w, h, ['#050a1e', '#0d1d3e', '#1c3358'], horizon);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + random() * 0.7})`;
      const s = random() * h * 0.0016 + 0.5;
      g.fillRect(random() * w, random() * horizon, s, s);
    }
    g.globalCompositeOperation = 'lighter'; // curtains of green and violet light
    for (let band = 0; band < 3; band++) {
      const hue = band === 2 ? 'rgba(170,110,255,' : 'rgba(90,255,180,';
      for (let x = 0; x < w; x += w / 260) {
        const t = x / w;
        const top = h * (0.12 + band * 0.06 + 0.08 * Math.sin(t * 6 + band * 2) + 0.04 * Math.sin(t * 17 + band));
        const len = h * (0.18 + 0.1 * Math.sin(t * 9 + band * 3));
        const grad = g.createLinearGradient(0, top, 0, top + len);
        grad.addColorStop(0, `${hue}0)`);
        grad.addColorStop(0.75, `${hue}${0.16 - band * 0.03})`);
        grad.addColorStop(1, `${hue}0)`);
        g.fillStyle = grad;
        g.fillRect(x, top, w / 240, len);
      }
    }
    g.globalCompositeOperation = 'source-over';
    hills(g, w, horizon + h * 0.04, h * 0.32, '#1b2a48', 21, true);
    hills(g, w, h, h * 0.22, '#0f1a30', 33, true);
  }

  function draw(canvas, id, width, height) {
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext('2d');
    if (id === 'aurora') aurora(g, width, height);
    else goldenGate(g, width, height, LOOKS[id] || LOOKS['gg-snow-night']);
    return canvas;
  }

  global.PanefallWallpapers = { list: LIST, draw };
})(window);
