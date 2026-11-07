// Persists Panefall's settings in <userData>/settings.json and validates every change, so a
// bad value from disk or from the Control Center can never reach the rest of the app.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const WEATHERS = ['snow', 'rain', 'storm', 'leaves', 'blossoms', 'clear'];

const DEFAULTS = Object.freeze({
  paused: false,
  mode: 'manual', // 'manual' = the weather you pick, 'live' = the real weather at `location`
  weather: 'snow',
  intensity: 0.35, // 0..1
  wind: 0.15, // -1 (blowing left) .. 1 (blowing right)
  size: 1, // 0.5..1.8
  depth: 0.5, // 0..1, how much collects on windows
  collectOnWindows: true,
  collectOnDock: true, // needs the Accessibility permission on macOS
  plow: true,
  lightning: true,
  umbrella: true, // weather parts around the mouse pointer
  overFullscreen: false,
  fps: 60, // 30 or 60
  pauseOnBattery: false,
  dryWeather: 'seasonal', // live mode when it is dry outside: 'seasonal' (leaves, blossoms) or 'clear'
  location: null, // { name, region, country, latitude, longitude }
  units: 'celsius', // or 'fahrenheit'
  menuBarTemperature: true,
  precipitationAlerts: true,
  shortcuts: true,
  showInDock: true,
  // Ambient sound (generated live; off until the user turns it on)
  soundOn: false,
  soundMaster: 0.6,
  soundRain: 0.7,
  soundWind: 0.5,
  soundFire: 0,
  soundThunder: 0.8,
  soundMatch: true, // rain only while it rains, wind follows the gusts
  nowPlaying: true, // show and control Apple Music / Spotify in the Quick Panel
});

const bool = (v) => (typeof v === 'boolean' ? v : undefined);
const oneOf = (...allowed) => (v) => (allowed.includes(v) ? v : undefined);
const range = (min, max) => (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined);
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

function location(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return undefined;
  const latitude = Number(v.latitude);
  const longitude = Number(v.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return undefined;
  }
  return { name: text(v.name, 80), region: text(v.region, 80), country: text(v.country, 80), latitude, longitude };
}

const SCHEMA = {
  paused: bool,
  mode: oneOf('manual', 'live'),
  weather: oneOf(...WEATHERS),
  intensity: range(0, 1),
  wind: range(-1, 1),
  size: range(0.5, 1.8),
  depth: range(0, 1),
  collectOnWindows: bool,
  collectOnDock: bool,
  plow: bool,
  lightning: bool,
  umbrella: bool,
  overFullscreen: bool,
  fps: oneOf(30, 60),
  pauseOnBattery: bool,
  dryWeather: oneOf('seasonal', 'clear'),
  location,
  units: oneOf('celsius', 'fahrenheit'),
  menuBarTemperature: bool,
  precipitationAlerts: bool,
  shortcuts: bool,
  showInDock: bool,
  soundOn: bool,
  soundMaster: range(0, 1),
  soundRain: range(0, 1),
  soundWind: range(0, 1),
  soundFire: range(0, 1),
  soundThunder: range(0, 1),
  soundMatch: bool,
  nowPlaying: bool,
};

/** Keeps only known keys with valid values (numbers are clamped into range). */
function sanitize(patch) {
  const clean = {};
  if (!patch || typeof patch !== 'object') return clean;
  for (const [key, check] of Object.entries(SCHEMA)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const value = check(patch[key]);
    if (value !== undefined) clean[key] = value;
  }
  return clean;
}

const file = () => path.join(app.getPath('userData'), 'settings.json');

function load() {
  try {
    return { ...DEFAULTS, ...sanitize(JSON.parse(fs.readFileSync(file(), 'utf8'))) };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(settings) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('[panefall] could not save settings:', err.message);
  }
}

module.exports = { DEFAULTS, WEATHERS, sanitize, load, save };
