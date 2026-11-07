// Panefall main process.
//   - one transparent, click-through overlay per display draws the weather
//   - the Control Center window is where people change everything
//   - a menu-bar icon (showing the live temperature) and global shortcuts for quick control
//   - a native helper reports where the other windows are (macOS today)
//   - live weather comes from Open-Meteo for the place the user picks
const {
  app,
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerMonitor,
  screen,
  shell,
  systemPreferences,
} = require('electron');
const path = require('path');
const settingsStore = require('./settings');
const MacWindowTracker = require('./mac-tracker');
const media = require('./media');
const { WeatherService, searchPlaces, seasonalWeather } = require('./weather');

const isMac = process.platform === 'darwin';
const ROOT = path.join(__dirname, '..', '..');
const PRELOAD = path.join(__dirname, '..', 'preload.js');
const CYCLE = ['snow', 'rain', 'storm', 'leaves', 'blossoms'];
const LABELS = { snow: 'Snow', rain: 'Rain', storm: 'Storm', leaves: 'Autumn Leaves', blossoms: 'Blossoms', clear: 'Calm' };

let settings = { ...settingsStore.DEFAULTS };
let tray = null;
let tracker = null;
let control = null;
let lastReport = null;
let onBattery = false;
let accessibilityPoll = null;
let weatherData = null;
let weatherError = null;
let lastAlertAt = 0;
let shortcutStatus = [];
let pointerTimer = null;
let lastPointer = null;
let panel = null; // the Quick Panel
let panelHiddenAt = 0;
let nowPlayingInfo = null;
let mediaTimer = null;
const overlays = new Map(); // display id -> BrowserWindow
const weather = new WeatherService();

app.setName('Panefall');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openControlCenter());
  app.whenReady().then(start);
  // The app keeps running (overlays + menu bar) when the Control Center is closed.
  app.on('window-all-closed', () => {});
  app.on('activate', () => openControlCenter()); // Dock icon clicked
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    if (tracker) tracker.stop();
    weather.stop();
  });
}

function start() {
  settings = settingsStore.load();
  applyDockVisibility();
  // Running from source (npm start) the Dock would otherwise show Electron's icon.
  if (isMac && !app.isPackaged) app.dock.setIcon(path.join(ROOT, 'assets', 'icon.png'));
  createTray();
  syncOverlays();
  for (const event of ['display-added', 'display-removed', 'display-metrics-changed']) {
    screen.on(event, () => syncOverlays());
  }

  onBattery = powerMonitor.isOnBatteryPower();
  powerMonitor.on('on-battery', () => {
    onBattery = true;
    refresh();
  });
  powerMonitor.on('on-ac', () => {
    onBattery = false;
    refresh();
  });
  powerMonitor.on('resume', () => weather.refresh());

  if (isMac) {
    tracker = new MacWindowTracker();
    tracker.on('update', (report) => {
      const accessibilityChanged = !lastReport || lastReport.accessibility !== report.accessibility;
      lastReport = report;
      broadcast('panefall:windows', report);
      if (accessibilityChanged) refresh();
    });
  }

  weather.on('update', (data) => {
    weatherData = data;
    weatherError = null;
    maybeAlert(data);
    refresh();
  });
  weather.on('error', (message) => {
    weatherError = message;
    refresh();
  });
  weather.configure(settings.location, settings.units);
  weather.start();

  registerIpc();
  registerShortcuts();
  refresh();

  const openedAtLogin = isMac && app.getLoginItemSettings().wasOpenedAtLogin;
  if (!openedAtLogin) openControlCenter();
  if (process.env.PANEFALL_DEBUG_DIR) startDebugSnapshots(process.env.PANEFALL_DEBUG_DIR);
}

// ---------------------------------------------------------------- state

const isPaused = () => settings.paused || (settings.pauseOnBattery && onBattery);

/** The weather to show right now: the live weather, or what the user picked. */
function scene() {
  if (settings.mode === 'live' && weatherData) {
    let { weather: kind, intensity } = weatherData.scene;
    if (kind === 'clear' && settings.dryWeather === 'seasonal') {
      kind = seasonalWeather(new Date(), weatherData.location.latitude);
      intensity = 0.3;
    }
    return { weather: kind, intensity, wind: weatherData.wind.screen, live: true };
  }
  return { weather: settings.weather, intensity: settings.intensity, wind: settings.wind, live: false };
}

/** What the overlays need to draw. */
function engineSettings() {
  const s = scene();
  return {
    paused: isPaused(),
    weather: s.weather,
    intensity: s.intensity,
    wind: s.wind,
    size: settings.size,
    depth: settings.depth,
    collectOnWindows: settings.collectOnWindows,
    collectOnDock: settings.collectOnDock,
    plow: settings.plow,
    lightning: settings.lightning,
    fps: settings.fps,
  };
}

/** Everything the Control Center shows. */
function fullState() {
  return {
    settings,
    scene: scene(),
    paused: isPaused(),
    onBattery,
    weather: weatherData,
    weatherError,
    accessibility: isMac ? systemPreferences.isTrustedAccessibilityClient(false) : true,
    openAtLogin: app.getLoginItemSettings().openAtLogin,
    canOpenAtLogin: app.isPackaged,
    shortcuts: shortcutStatus,
    nowPlaying: nowPlayingInfo,
    playMode,
    platform: process.platform,
    version: app.getVersion(),
  };
}

/** Sound plays from one overlay only: the one on the main display. */
function sendSound() {
  const primary = screen.getPrimaryDisplay().id;
  for (const [id, win] of overlays) {
    if (win.isDestroyed()) continue;
    win.webContents.send('panefall:sound', {
      on: settings.soundOn && !isPaused() && id === primary,
      master: settings.soundMaster,
      rain: settings.soundRain,
      wind: settings.soundWind,
      fire: settings.soundFire,
      thunder: settings.soundThunder,
      match: settings.soundMatch,
    });
  }
}

/** Pushes the current state everywhere: overlays, tracker, Control Center, menu bar. */
function refresh() {
  const engine = engineSettings();
  for (const win of overlays.values()) {
    if (win.isDestroyed() || win.webContents.isLoading()) continue;
    if (engine.paused) win.hide();
    else if (!win.isVisible()) win.showInactive();
  }
  broadcast('panefall:settings', engine);
  if (tracker) {
    if (engine.paused) tracker.stop();
    else tracker.start();
  }
  const state = fullState();
  if (control && !control.isDestroyed()) control.webContents.send('panefall:state', state);
  if (panel && !panel.isDestroyed()) panel.webContents.send('panefall:state', state);
  sendSound();
  updatePointerTracking();
  updateTray();
}

/** The umbrella cursor: tell the overlays where the mouse is (about 30 times a second). */
function updatePointerTracking() {
  const on = settings.umbrella && !isPaused();
  if (on && !pointerTimer) {
    pointerTimer = setInterval(() => {
      const p = screen.getCursorScreenPoint();
      if (lastPointer && p.x === lastPointer.x && p.y === lastPointer.y) return;
      lastPointer = p;
      broadcast('panefall:pointer', p);
    }, 33);
  } else if (!on && pointerTimer) {
    clearInterval(pointerTimer);
    pointerTimer = null;
    lastPointer = null;
    broadcast('panefall:pointer', null);
  }
}

function update(patch) {
  const clean = settingsStore.sanitize(patch);
  if (!Object.keys(clean).length) return;
  const prev = settings;
  settings = { ...settings, ...clean };
  settingsStore.save(settings);

  if (settings.overFullscreen !== prev.overFullscreen) for (const win of overlays.values()) setFullscreenVisibility(win);
  if (settings.showInDock !== prev.showInDock) applyDockVisibility();
  if (settings.shortcuts !== prev.shortcuts) registerShortcuts();
  if (settings.location !== prev.location || settings.units !== prev.units) {
    weatherData = null;
    weatherError = null;
    weather.configure(settings.location, settings.units);
  }
  refresh();
}

// ---------------------------------------------------------------- commands

const COMMANDS = {
  togglePause: () => update({ paused: !settings.paused }),
  nextWeather: () => {
    const next = CYCLE[(CYCLE.indexOf(settings.weather) + 1) % CYCLE.length];
    update({ mode: 'manual', weather: next, paused: false });
  },
  sweep: () => broadcast('panefall:command', 'clear'),
  plow: () => broadcast('panefall:command', 'plow'),
  // Toys. 'pointer' = right where the mouse is; otherwise somewhere sensible on that display.
  snowman: (where) => toDisplayUnderPointer('snowman', where === 'pointer'),
  snowball: (where) => toDisplayUnderPointer('snowball', where === 'pointer'),
  gust: () => broadcast('panefall:command', { name: 'gust' }),
  thunder: () => broadcast('panefall:command', { name: 'thunder' }),
  togglePanel: () => togglePanel(),
  play: () => setPlayMode(!playMode),
  media: async (action) => {
    await media.control(action, nowPlayingInfo);
    setTimeout(pollNowPlaying, 300);
  },
  refreshWeather: () => weather.refresh(),
  requestAccessibility: () => requestAccessibility(),
  openAtLogin: (on) => {
    app.setLoginItemSettings({ openAtLogin: Boolean(on) });
    refresh();
  },
  openControlCenter: () => openControlCenter(),
  quit: () => app.quit(),
};

const SHORTCUTS = [
  { accelerator: 'Control+Alt+S', label: 'Open the Quick Panel', command: 'togglePanel' },
  { accelerator: 'Control+Alt+H', label: 'Play with the weather (Esc to stop)', command: 'play' },
  { accelerator: 'Control+Alt+M', label: 'Build a snowman under the pointer', command: 'snowman', arg: 'pointer' },
  { accelerator: 'Control+Alt+B', label: 'Throw a snowball at the window under the pointer', command: 'snowball', arg: 'pointer' },
  { accelerator: 'Control+Alt+W', label: 'Pause or resume the weather', command: 'togglePause' },
  { accelerator: 'Control+Alt+N', label: 'Switch to the next weather', command: 'nextWeather' },
  { accelerator: 'Control+Alt+K', label: 'Sweep everything away', command: 'sweep' },
  { accelerator: 'Control+Alt+P', label: 'Send the snowplow', command: 'plow' },
  { accelerator: 'Control+Alt+O', label: 'Open the Control Center', command: 'openControlCenter' },
];

// Play mode: for a little while the weather takes the mouse. Drag to sweep it, flick to throw
// snowballs, double-click for a snowman. Esc (or 90 seconds) gives the mouse back to your apps.
let playMode = false;
let playTimer = null;

function setPlayMode(on) {
  if (on === playMode) return;
  playMode = on;
  for (const win of overlays.values()) if (!win.isDestroyed()) win.setIgnoreMouseEvents(!on);
  broadcast('panefall:play', on);
  clearTimeout(playTimer);
  if (on) {
    hidePanel();
    try {
      globalShortcut.register('Escape', () => setPlayMode(false));
    } catch {
      // Esc is taken; the timer and the panel button still end it
    }
    playTimer = setTimeout(() => setPlayMode(false), 90_000);
  } else if (globalShortcut.isRegistered('Escape')) {
    globalShortcut.unregister('Escape');
  }
  refresh();
}

function toDisplayUnderPointer(name, atPointer) {
  const at = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(at);
  broadcast('panefall:command', { name, displayId: display.id, at: atPointer ? at : null });
}

function registerShortcuts() {
  globalShortcut.unregisterAll();
  shortcutStatus = SHORTCUTS.map(({ accelerator, label, command, arg }) => {
    let registered = false;
    if (settings.shortcuts) {
      try {
        registered = globalShortcut.register(accelerator, () => COMMANDS[command](arg));
      } catch {
        registered = false;
      }
    }
    return { accelerator, label, registered, enabled: settings.shortcuts };
  });
}

function registerIpc() {
  // Only the Control Center and the Quick Panel may change settings or run commands.
  const isUi = (win, event) => Boolean(win && !win.isDestroyed() && event.sender === win.webContents);
  const fromControl = (event) => isUi(control, event) || isUi(panel, event);

  ipcMain.handle('panefall:getState', (event) => (fromControl(event) ? fullState() : null));
  ipcMain.handle('panefall:update', (event, patch) => {
    if (fromControl(event)) update(patch);
    return fullState();
  });
  ipcMain.handle('panefall:command', (event, name, arg) => {
    if (!fromControl(event) || !Object.prototype.hasOwnProperty.call(COMMANDS, name)) return false;
    COMMANDS[name](arg);
    return true;
  });
  ipcMain.handle('panefall:searchPlaces', async (event, query) => {
    if (!fromControl(event)) return { places: [] };
    try {
      return { places: await searchPlaces(query) };
    } catch (err) {
      return { places: [], error: err.message };
    }
  });
}

function requestAccessibility() {
  if (!isMac) return;
  // Shows the system prompt that leads to System Settings > Privacy & Security > Accessibility.
  systemPreferences.isTrustedAccessibilityClient(true);
  clearInterval(accessibilityPoll);
  let tries = 0;
  accessibilityPoll = setInterval(() => {
    if (systemPreferences.isTrustedAccessibilityClient(false)) {
      clearInterval(accessibilityPoll);
      update({ collectOnDock: true });
      if (tracker) tracker.restart();
      refresh();
    } else if (++tries > 90) {
      clearInterval(accessibilityPoll);
    }
  }, 2000);
}

/** A notification shortly before rain or snow starts at the chosen place. */
function maybeAlert(data) {
  if (!settings.precipitationAlerts || !Notification.isSupported()) return;
  if (data.scene.weather !== 'clear') return; // it is already raining or snowing
  if (Date.now() - lastAlertAt < 3 * 60 * 60 * 1000) return;
  const soon = data.hourly.slice(0, 2).find((h) => h.weather !== 'clear' && (h.precipitationProbability ?? 0) >= 60);
  if (!soon) return;
  lastAlertAt = Date.now();
  const what = soon.weather === 'snow' ? 'Snow' : soon.weather === 'storm' ? 'A thunderstorm' : 'Rain';
  new Notification({
    title: `${what} on the way`,
    body: `${soon.precipitationProbability}% chance in the next hour or two in ${data.location.name}.`,
  }).show();
}

// ---------------------------------------------------------------- windows

function applyDockVisibility() {
  if (!isMac) return;
  if (settings.showInDock) app.dock.show();
  else app.dock.hide();
}

function openControlCenter() {
  if (!app.isReady()) return;
  if (control && !control.isDestroyed()) {
    if (control.isMinimized()) control.restore();
    control.show();
    control.focus();
    return;
  }
  control = new BrowserWindow({
    width: 820,
    height: 780,
    minWidth: 680,
    minHeight: 560,
    title: 'Panefall',
    show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    vibrancy: isMac ? 'under-window' : undefined,
    visualEffectState: isMac ? 'active' : undefined,
    backgroundColor: isMac ? '#00000000' : '#17191f',
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
  });
  control.loadFile(path.join(__dirname, '..', 'control', 'index.html'));
  control.once('ready-to-show', () => control.show());
  control.on('closed', () => {
    control = null;
  });
  // Links (e.g. the Open-Meteo credit) open in the browser; the window never navigates away.
  control.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  control.webContents.on('will-navigate', (event) => event.preventDefault());
  logPageProblems(control, 'control');
}

// ---------------------------------------------------------------- Quick Panel

/** A slim panel at the right edge of the screen: weather, toys, sounds and music. */
function togglePanel() {
  if (panel && !panel.isDestroyed() && panel.isVisible()) return hidePanel();
  // A click on the menu-bar icon blurs (and so hides) the panel first; don't reopen it.
  if (Date.now() - panelHiddenAt < 250) return undefined;
  return showPanel();
}

function showPanel() {
  if (!app.isReady()) return;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const area = display.workArea;
  // A compact card floating at the right edge, centred vertically (with room above it for
  // snow to settle on it).
  const width = 304;
  const height = Math.min(596, area.height - 60);
  const bounds = {
    x: area.x + area.width - width - 14,
    y: Math.round(area.y + Math.max(36, (area.height - height) / 2)),
    width,
    height,
  };
  if (!panel || panel.isDestroyed()) {
    panel = new BrowserWindow({
      ...bounds,
      show: false,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      vibrancy: isMac ? 'popover' : undefined,
      visualEffectState: isMac ? 'active' : undefined,
      backgroundColor: isMac ? '#00000000' : '#1b1e27',
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true },
    });
    panel.setAlwaysOnTop(true, 'floating');
    panel.loadFile(path.join(__dirname, '..', 'panel', 'index.html'));
    // It tucks itself away when you click elsewhere (except while debugging, so it can be captured).
    panel.on('blur', () => {
      if (!process.env.PANEFALL_DEBUG_DIR) hidePanel();
    });
    panel.on('closed', () => {
      panel = null;
    });
    panel.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    panel.webContents.on('will-navigate', (event) => event.preventDefault());
    logPageProblems(panel, 'panel');
    panel.once('ready-to-show', () => revealPanel());
  } else {
    revealPanel();
  }
  panel.setBounds(bounds);
}

function revealPanel() {
  panel.show();
  panel.focus();
  panel.webContents.send('panefall:panel-shown');
  panel.webContents.send('panefall:state', fullState());
  startMediaPolling();
}

function hidePanel() {
  if (!panel || panel.isDestroyed() || !panel.isVisible()) return;
  panel.hide();
  panelHiddenAt = Date.now();
  stopMediaPolling();
}

function startMediaPolling() {
  stopMediaPolling();
  if (!settings.nowPlaying || !isMac) return;
  pollNowPlaying();
  mediaTimer = setInterval(pollNowPlaying, 2000);
}

function stopMediaPolling() {
  clearInterval(mediaTimer);
  mediaTimer = null;
}

async function pollNowPlaying() {
  const info = settings.nowPlaying ? await media.nowPlaying() : null;
  if (JSON.stringify(info) === JSON.stringify(nowPlayingInfo)) return;
  nowPlayingInfo = info;
  if (panel && !panel.isDestroyed()) panel.webContents.send('panefall:state', fullState());
}

function syncOverlays() {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => d.id));
  for (const [id, win] of overlays) {
    if (!ids.has(id)) {
      win.destroy();
      overlays.delete(id);
    }
  }
  for (const display of displays) {
    const win = overlays.get(display.id);
    if (!win) {
      overlays.set(display.id, createOverlay(display));
    } else {
      win.setBounds(display.bounds);
      sendDisplay(win, display);
    }
  }
}

function createOverlay(display) {
  const win = new BrowserWindow({
    ...display.bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    enableLargerThanScreen: true,
    roundedCorners: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required', // ambient sound starts without a click
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, 'screen-saver');
  setFullscreenVisibility(win);
  win.setBounds(display.bounds); // cover the whole display, menu bar included
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  logPageProblems(win, `overlay ${display.id}`);
  win.webContents.on('did-finish-load', () => {
    sendDisplay(win, display);
    win.webContents.send('panefall:settings', engineSettings());
    if (lastReport) win.webContents.send('panefall:windows', lastReport);
    sendSound();
    if (!isPaused()) win.showInactive();
  });
  return win;
}

function setFullscreenVisibility(win) {
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: settings.overFullscreen, skipTransformProcessType: true });
}

function sendDisplay(win, display) {
  win.webContents.send('panefall:display', { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor });
}

function broadcast(channel, payload) {
  for (const win of overlays.values()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function logPageProblems(win, name) {
  win.webContents.on('console-message', ({ level, message }) => {
    if (level === 'warning' || level === 'error') console.log(`[${name}] ${level}: ${message}`);
  });
}

// ---------------------------------------------------------------- menu bar

let trayMenu = null;

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(ROOT, 'assets', 'trayTemplate.png')));
  tray.setToolTip('Panefall');
  // Click: the Quick Panel. Right-click (or Control-click): the menu.
  tray.on('click', () => togglePanel());
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu));
  updateTray();
}

const formatTemperature = (t) => `${Math.round(t)}°`;

function updateTray() {
  if (!tray) return;
  tray.setTitle(settings.menuBarTemperature && weatherData ? ` ${formatTemperature(weatherData.temperature)}` : '');
  const accel = (key) => (settings.shortcuts ? key : undefined);
  const place = weatherData
    ? `${weatherData.location.name}: ${formatTemperature(weatherData.temperature)}, ${weatherData.description}`
    : settings.location
      ? `${settings.location.name}: loading weather…`
      : 'Live weather: choose a place in the Control Center';
  const pick = (kind) => ({
    label: LABELS[kind],
    type: 'radio',
    checked: settings.mode === 'manual' && settings.weather === kind,
    click: () => update({ mode: 'manual', weather: kind, paused: false }),
  });

  trayMenu = Menu.buildFromTemplate([
      { label: 'Open Quick Panel', accelerator: accel('Control+Alt+S'), click: () => showPanel() },
      { label: 'Open Control Center…', accelerator: accel('Control+Alt+O'), click: () => openControlCenter() },
      { type: 'separator' },
      { label: 'Build a Snowman', click: () => COMMANDS.snowman() },
      { label: 'Throw a Snowball', click: () => COMMANDS.snowball() },
      { type: 'separator' },
      { label: place, enabled: false },
      {
        label: 'Live Weather',
        type: 'radio',
        checked: settings.mode === 'live',
        enabled: Boolean(settings.location),
        click: () => update({ mode: 'live', paused: false }),
      },
      ...['snow', 'rain', 'storm', 'leaves', 'blossoms', 'clear'].map(pick),
      { type: 'separator' },
      { label: settings.paused ? 'Resume' : 'Pause', accelerator: accel('Control+Alt+W'), click: COMMANDS.togglePause },
      { label: 'Sweep Everything Away', accelerator: accel('Control+Alt+K'), click: COMMANDS.sweep },
      { label: 'Send the Snowplow', accelerator: accel('Control+Alt+P'), click: COMMANDS.plow },
      { type: 'separator' },
      { label: 'Quit Panefall', role: 'quit' },
  ]);
}

// ---------------------------------------------------------------- debugging

// `PANEFALL_DEBUG_DIR=/some/dir npm start` saves an image of every overlay (plus the engine's
// state) and of the Control Center there every 10 seconds.
function startDebugSnapshots(dir) {
  const fs = require('fs');
  fs.mkdirSync(dir, { recursive: true });
  const stats = `(() => {
    const e = window.panefallEngine;
    return JSON.stringify({
      size: [e.width, e.height, e.dpr], origin: e.origin, settings: e.settings,
      particles: e.particles.length, beads: e.beads.length, pointer: e.pointer, snowmen: e.snowmen.length,
      splats: e.beads.filter((b) => b.splat).length,
      windowsReported: e.report ? e.report.windows.length : null,
      surfaces: [...e.surfaces.values()].map((s) => ({ key: s.key, x: s.x, y: s.y, w: s.w,
        visibleCols: s.vis.reduce((a, b) => a + b, 0), cols: s.n, snow: Math.round(s.h.reduce((a, b) => a + b, 0)), items: s.items.length })),
    });
  })()`;
  // Exercise the Quick Panel and the toys once, so they show up in the snapshots.
  setTimeout(() => {
    showPanel();
    COMMANDS.snowman();
    COMMANDS.snowball();
  }, 4000);
  setInterval(async () => {
    const targets = [...overlays].map(([id, win]) => [`overlay-${id}`, win]);
    if (control && !control.isDestroyed()) targets.push(['control', control]);
    if (panel && !panel.isDestroyed() && panel.isVisible()) targets.push(['panel', panel]);
    for (const [name, win] of targets) {
      if (win.isDestroyed()) continue;
      try {
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(dir, `${name}.png`), image.toPNG());
        if (name.startsWith('overlay')) fs.writeFileSync(path.join(dir, `${name}.json`), await win.webContents.executeJavaScript(stats));
      } catch (err) {
        console.error('[panefall] debug snapshot failed:', err.message);
      }
    }
  }, 10_000);
}
