#!/usr/bin/env node
// `npm start`: runs Panefall from source.
//
// On macOS the app would otherwise show up as "Electron" (menu bar, Dock, notifications,
// permission prompts), so this first makes build/Panefall.app: a copy of Electron's app bundle
// (an instant APFS clone) with Panefall's name, icon and bundle id, re-signed for this Mac.
// It is rebuilt only when Electron or the icon changes. It also builds the native window
// helper, and clears ELECTRON_RUN_AS_NODE (set by VS Code's terminal), on every platform.
const { execFileSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');

function run(file, args, options = {}) {
  execFileSync(file, args, { stdio: options.quiet ? 'ignore' : 'inherit', ...options });
}

function devBundle() {
  const electronApp = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app');
  const app = path.join(BUILD, 'Panefall.app');
  const plist = path.join(app, 'Contents', 'Info.plist');
  const icon = path.join(ROOT, 'assets', 'icon.png');
  const stampFile = path.join(BUILD, 'Panefall.app.stamp');
  const stamp = `${require('electron/package.json').version} ${fs.statSync(icon).mtimeMs}`;
  const executable = path.join(app, 'Contents', 'MacOS', 'Electron');

  if (fs.existsSync(executable) && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp) return executable;

  console.log('start: making build/Panefall.app (only needed once)…');
  fs.rmSync(app, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  try {
    run('/bin/cp', ['-cR', electronApp, app], { quiet: true }); // APFS clone: instant, no extra space
  } catch {
    run('/bin/cp', ['-R', electronApp, app]);
  }

  const set = (key, value) => {
    try {
      run('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, plist], { quiet: true });
    } catch {
      run('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, plist], { quiet: true });
    }
  };
  set('CFBundleName', 'Panefall');
  set('CFBundleDisplayName', 'Panefall');
  set('CFBundleIdentifier', 'app.panefall.dev');
  set('CFBundleIconFile', 'panefall.icns');

  // Turn assets/icon.png into an .icns for the bundle.
  const iconset = path.join(BUILD, 'panefall.iconset');
  fs.rmSync(iconset, { recursive: true, force: true });
  fs.mkdirSync(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    run('/usr/bin/sips', ['-z', String(size), String(size), icon, '--out', path.join(iconset, `icon_${size}x${size}.png`)], { quiet: true });
    run('/usr/bin/sips', ['-z', String(size * 2), String(size * 2), icon, '--out', path.join(iconset, `icon_${size}x${size}@2x.png`)], { quiet: true });
  }
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', path.join(app, 'Contents', 'Resources', 'panefall.icns')]);
  fs.rmSync(iconset, { recursive: true, force: true });

  // Editing the bundle invalidates Electron's signature; sign it again for this Mac.
  run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app], { quiet: true });
  fs.writeFileSync(stampFile, stamp);
  return executable;
}

let binary;
if (process.platform === 'darwin') {
  run('/bin/bash', [path.join(__dirname, 'build-mac-helper.sh')]);
  binary = devBundle();
} else {
  binary = require('electron'); // path to the Electron binary
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(binary, [ROOT, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
