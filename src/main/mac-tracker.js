// Runs the native macOS window tracker (native/mac/WindowTracker.swift) and turns its
// JSON lines into 'update' events: { windows, menubars, dock, accessibility }.
const { app } = require('electron');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'panefall-window-tracker')
    : path.join(__dirname, '..', '..', 'build', 'bin', 'panefall-window-tracker');
}

const rect = ([x, y, w, h]) => ({ x, y, w, h });

class MacWindowTracker extends EventEmitter {
  constructor() {
    super();
    this.child = null;
    this.running = false;
    this.crashes = [];
    this.restartTimer = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.spawn();
  }

  stop() {
    this.running = false;
    clearTimeout(this.restartTimer);
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
      this.child = null;
    }
  }

  /** Restart the helper, e.g. after Accessibility was granted. */
  restart() {
    if (!this.running) return;
    this.stop();
    this.start();
  }

  spawn() {
    const bin = helperPath();
    if (!fs.existsSync(bin)) {
      console.warn(`[panefall] window tracker not found at ${bin}. Run "npm run build:helper". Weather will only collect along the bottom of the screen.`);
      return;
    }
    const child = spawn(bin, ['--exclude-pid', '0'], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.child = child;

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      let raw;
      try {
        raw = JSON.parse(line);
      } catch {
        return;
      }
      this.emit('update', {
        windows: raw.w.map(([id, x, y, w, h]) => ({ id, x, y, w, h })),
        menubars: raw.m.map(rect),
        dock: raw.d ? rect(raw.d) : null,
        accessibility: Boolean(raw.ax),
      });
    });

    child.on('error', (err) => console.error('[panefall] window tracker failed to start:', err.message));
    child.on('exit', (code, signal) => {
      if (this.child === child) this.child = null;
      if (!this.running) return;
      const now = Date.now();
      this.crashes = this.crashes.filter((t) => now - t < 60_000).concat(now);
      if (this.crashes.length > 5) {
        console.error('[panefall] window tracker keeps exiting; giving up. Weather will only collect along the bottom of the screen.');
        return;
      }
      console.warn(`[panefall] window tracker exited (${code ?? signal}); restarting`);
      this.restartTimer = setTimeout(() => this.spawn(), 1000);
    });
  }
}

module.exports = MacWindowTracker;
