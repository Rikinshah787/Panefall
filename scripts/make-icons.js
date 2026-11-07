#!/usr/bin/env node
// Draws Panefall's icons and writes them as PNGs into assets/:
//   icon.png                                1024px app icon: a window pane with snow on its
//                                           sill and raindrops on the glass (electron-builder
//                                           turns it into .icns / .ico)
//   trayTemplate.png / trayTemplate@2x.png  menu-bar icon (black + alpha, a macOS template image)
// No dependencies: shapes are drawn from distance functions and encoded with zlib.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'assets');

// ------------------------------------------------------------------ PNG encoding

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ------------------------------------------------------------------ shapes (coverage 0..1)

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function roundRect(x0, y0, w, h, r) {
  return (x, y) => {
    const qx = Math.abs(x - (x0 + w / 2)) - (w / 2 - r);
    const qy = Math.abs(y - (y0 + h / 2)) - (h / 2 - r);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    return clamp01(0.5 - d);
  };
}

const circle = (cx, cy, r) => (x, y) => clamp01(r - Math.hypot(x - cx, y - cy) + 0.5);
const union = (...shapes) => (x, y) => Math.max(...shapes.map((s) => s(x, y)));
const minus = (a, b) => (x, y) => a(x, y) * (1 - b(x, y));
const above = (shape, limit) => (x, y) => shape(x, y) * clamp01(limit - y + 0.5);

/** A window frame: outline plus a cross of mullions, all scaled by `s` from a 32-unit design. */
function windowFrame(s, { x, y, w, h, r, stroke, bar }) {
  const outer = roundRect(x * s, y * s, w * s, h * s, r * s);
  const inner = roundRect((x + stroke) * s, (y + stroke) * s, (w - 2 * stroke) * s, (h - 2 * stroke) * s, Math.max(0.5, r - stroke) * s);
  const cx = (x + w / 2) * s;
  const cy = (y + h / 2) * s;
  const vertical = roundRect(cx - (bar / 2) * s, y * s, bar * s, h * s, 0.01);
  const horizontal = roundRect(x * s, cy - (bar / 2) * s, w * s, bar * s, 0.01);
  return { frame: union(minus(outer, inner), (px, py) => Math.min(inner(px, py), Math.max(vertical(px, py), horizontal(px, py)))), glass: inner };
}

/** A lumpy cap of snow resting on a line at `baseY`, built from overlapping circles. */
function snowCap(s, baseY, bumps) {
  return above(union(...bumps.map(([cx, r]) => circle(cx * s, baseY * s, r * s))), (baseY + 0.4) * s);
}

function render(size, layers) {
  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0; // premultiplied
      for (const layer of layers) {
        const cov = layer.shape(px, py) * (layer.alpha ?? 1);
        if (cov <= 0) continue;
        const c = typeof layer.color === 'function' ? layer.color(px, py) : layer.color;
        r = c[0] * cov + r * (1 - cov);
        g = c[1] * cov + g * (1 - cov);
        b = c[2] * cov + b * (1 - cov);
        a = cov + a * (1 - cov);
      }
      if (a <= 0) continue;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / a);
      rgba[i + 1] = Math.round(g / a);
      rgba[i + 2] = Math.round(b / a);
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, rgba);
}

const mix = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * clamp01(t));

// ------------------------------------------------------------------ icons

function appIcon(size) {
  const s = size / 32; // design on a 32-unit grid
  const body = roundRect(3.125 * s, 3.125 * s, 25.75 * s, 25.75 * s, 5.8 * s); // macOS icon grid
  const sky = (x, y) => mix([58, 92, 168], [24, 28, 72], (y / s - 3) / 26);
  const pane = { x: 8.6, y: 11.6, w: 14.8, h: 13.6, r: 1.4, stroke: 1.15, bar: 0.9 };
  const { frame, glass } = windowFrame(s, pane);
  const cap = snowCap(s, pane.y + 0.5, [
    [8.7, 1.5],
    [10.4, 2.0],
    [12.4, 1.7],
    [14.4, 2.2],
    [16.5, 1.9],
    [18.6, 2.15],
    [20.8, 1.75],
    [22.6, 1.55],
    [23.5, 1.0],
  ]);
  const beads = union(circle(11.6 * s, 15.2 * s, 0.62 * s), circle(19.6 * s, 21.6 * s, 0.75 * s), circle(18.9 * s, 15.9 * s, 0.45 * s), circle(12.4 * s, 21.2 * s, 0.4 * s));
  const flakes = union(circle(9.2 * s, 7.4 * s, 0.55 * s), circle(15.6 * s, 6.1 * s, 0.42 * s), circle(22.4 * s, 7.6 * s, 0.6 * s), circle(25.4 * s, 12.6 * s, 0.38 * s), circle(6.4 * s, 13.2 * s, 0.4 * s));

  return render(size, [
    { shape: body, color: sky },
    { shape: (x, y) => body(x, y) * glass(x, y), color: [255, 255, 255], alpha: 0.1 },
    { shape: (x, y) => body(x, y) * beads(x, y), color: [235, 242, 255], alpha: 0.75 },
    { shape: (x, y) => body(x, y) * frame(x, y), color: [236, 241, 252] },
    { shape: (x, y) => body(x, y) * cap(x, y), color: (x, y) => mix([255, 255, 255], [214, 225, 242], (y / s - 9) / 3.2) },
    { shape: (x, y) => body(x, y) * flakes(x, y), color: [255, 255, 255], alpha: 0.9 },
  ]);
}

function trayIcon(size) {
  const s = size / 32;
  const pane = { x: 6, y: 12.5, w: 20, h: 15.5, r: 2.2, stroke: 2.3, bar: 1.9 };
  const { frame } = windowFrame(s, pane);
  const cap = snowCap(s, pane.y + 0.6, [
    [6.6, 2.6],
    [10.6, 3.4],
    [15.6, 3.1],
    [20.6, 3.5],
    [25.2, 2.7],
  ]);
  return render(size, [{ shape: union(frame, cap), color: [0, 0, 0] }]);
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon.png'), appIcon(1024));
fs.writeFileSync(path.join(OUT, 'trayTemplate.png'), trayIcon(16));
fs.writeFileSync(path.join(OUT, 'trayTemplate@2x.png'), trayIcon(32));
console.log('icons: wrote assets/icon.png, assets/trayTemplate.png, assets/trayTemplate@2x.png');
