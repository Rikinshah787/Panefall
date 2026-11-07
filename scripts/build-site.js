#!/usr/bin/env node
// Copies the weather engine and the app icon into docs/, so the website (GitHub Pages serves
// the docs/ folder) runs exactly the same simulation as the app. Run after changing the engine.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const COPIES = [
  ['src/renderer/sim.js', 'docs/engine/sim.js'],
  ['src/renderer/plow.js', 'docs/engine/plow.js'],
  ['assets/icon.png', 'docs/assets/icon.png'],
];

for (const [from, to] of COPIES) {
  const target = path.join(ROOT, to);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), target);
  console.log(`site: ${from} -> ${to}`);
}
