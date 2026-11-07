/*
 * The Control Center: everything people can change about Panefall.
 * In the app it talks to the main process through `window.panefall`; opened in a plain
 * browser it runs against a built-in preview (sample weather), which is handy for design
 * work and screenshots.
 */
(function () {
  'use strict';

  const api = window.panefall && window.panefall.getState ? window.panefall : createPreviewApi();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];

  const VERBS = {
    snow: 'Snowing',
    rain: 'Raining',
    storm: 'Storming',
    leaves: 'Leaves falling',
    blossoms: 'Blossoms drifting',
    clear: 'Calm',
  };

  let state = null;
  let dragging = null; // the slider being dragged, so incoming state doesn't fight the pointer

  // ------------------------------------------------------------ helpers

  const isMac = () => (state ? state.platform === 'darwin' : /Mac/i.test(navigator.platform));
  const temperature = (t) => `${Math.round(t)}°`;
  const placeLabel = (p) => [p.name, p.country].filter(Boolean).join(', ');
  const compass = (deg) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(deg / 45) % 8];

  function keys(accelerator) {
    if (!isMac()) return accelerator.replace(/Control/g, 'Ctrl').replace(/\+/g, ' + ');
    return accelerator.replace('Control+', '⌃').replace('Alt+', '⌥').replace('Shift+', '⇧').replace('Command+', '⌘');
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function icon(name, className) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `icon ${className || ''}`);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function hourLabel(iso, index) {
    if (index === 0) return 'Now';
    const hour = Number(iso.slice(11, 13));
    return new Date(2000, 0, 1, hour).toLocaleTimeString([], { hour: 'numeric' });
  }

  function describeValue(key, v) {
    if (key === 'intensity') return v < 0.2 ? 'Gentle' : v < 0.45 ? 'Steady' : v < 0.75 ? 'Heavy' : 'Wild';
    if (key === 'wind') return Math.abs(v) < 0.08 ? 'Still' : `${v < 0 ? '←' : '→'} ${Math.round(Math.abs(v) * 100)}%`;
    if (key === 'size') return `×${v.toFixed(1)}`;
    if (key === 'depth') return v < 0.25 ? 'A dusting' : v < 0.6 ? 'Cozy' : v < 0.85 ? 'Deep' : 'Snowed in';
    if (key.startsWith('sound')) return v < 0.02 ? 'Off' : `${Math.round(v * 100)}%`;
    return '';
  }

  // ------------------------------------------------------------ rendering

  function render(next) {
    if (!next) return;
    state = next;
    const s = state.settings;
    const root = document.documentElement;
    root.classList.toggle('vibrant', state.platform === 'darwin' && !state.preview);
    root.classList.toggle('windows', state.platform === 'win32');

    const pause = $('#pause');
    pause.textContent = s.paused ? 'Resume' : 'Pause';
    pause.classList.toggle('paused', s.paused);
    $('#status').textContent = statusLine();

    for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', String(s.mode === b.dataset.mode));
    for (const b of $$('[data-weather]')) b.setAttribute('aria-pressed', String(state.scene.weather === b.dataset.weather));
    $('#scenes').classList.toggle('following', s.mode === 'live');
    $('#live').hidden = s.mode !== 'live';

    for (const input of $$('[data-setting]')) {
      if (input === dragging) continue;
      const value = s[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    $('#fps30').checked = s.fps === 30;

    const followingLive = s.mode === 'live' && Boolean(state.weather);
    $('[data-setting="intensity"]').disabled = followingLive;
    $('[data-setting="wind"]').disabled = followingLive;
    $('#live-note').hidden = !followingLive;
    paintSliders();

    const mac = state.platform === 'darwin';
    const needsPermission = mac && !state.accessibility;
    $('#dock-row').hidden = !mac;
    $('#dock-icon-row').hidden = !mac;
    $('#dock-allow').hidden = !needsPermission;
    $('[data-setting="collectOnDock"]').disabled = needsPermission;
    $('#dock-note').textContent = needsPermission
      ? 'Needs the Accessibility permission to see the Dock'
      : 'Snow and leaves settle on top of the Dock';

    // Browser music control presses the media keys, which needs Accessibility.
    const keysNeedPermission = mac && s.mediaKeys && !state.accessibility;
    $('#media-keys-row').hidden = !mac;
    $('#media-keys-allow').hidden = !keysNeedPermission;
    $('#media-keys-note').textContent = keysNeedPermission
      ? 'Needs the Accessibility permission to press the media keys'
      : "Play, pause and skip Brave, Chrome or Safari from the panel, using the Mac's media keys";

    const login = $('#openAtLogin');
    login.checked = Boolean(state.openAtLogin);
    login.disabled = !state.canOpenAtLogin;
    $('#login-note').textContent = state.canOpenAtLogin ? 'Start Panefall when you log in' : 'Available in the installed app';

    renderWeather();
    renderShortcuts();
    $('#version').textContent = state.version ? `v${state.version}` : '';
  }

  function statusLine() {
    const s = state.settings;
    const scene = state.scene;
    if (s.paused) return 'Paused';
    if (state.paused) return 'Paused while on battery';
    const verb = VERBS[scene.weather] || 'Calm';
    if (scene.live && state.weather) return `${verb} · following the weather in ${state.weather.location.name}`;
    return verb;
  }

  function renderWeather() {
    const s = state.settings;
    $('#place').placeholder = s.location ? `${placeLabel(s.location)} · type to change` : 'Search for your city';
    const now = $('#now');
    const hours = $('#hours');
    now.replaceChildren();
    hours.replaceChildren();

    if (!s.location) {
      now.append(el('p', 'note', 'Pick a place and Panefall rains when it rains there, snows when it snows, and follows the wind.'));
      return;
    }
    const w = state.weather;
    if (!w) {
      now.append(el('p', 'note', state.weatherError ? `Couldn’t get the weather: ${state.weatherError}` : 'Getting the weather…'));
      return;
    }

    const kind = w.scene.weather === 'clear' ? (w.isDay ? 'clear' : 'night') : w.scene.weather;
    const what = el('div', 'what');
    what.append(
      el('b', '', w.description),
      el('small', '', `${placeLabel(w.location)} · wind ${Math.round(w.wind.speed)} km/h from ${compass(w.wind.direction)}`),
    );
    now.append(icon(kind, 'big'), el('span', 'temp', temperature(w.temperature)), what);

    w.hourly.slice(0, 10).forEach((h, i) => {
      const li = el('li');
      const chance = h.precipitationProbability;
      li.append(
        el('span', 't', hourLabel(h.time, i)),
        icon(h.weather === 'clear' ? 'cloud' : h.weather),
        el('span', '', temperature(h.temperature)),
        el('span', 'p', chance ? `${chance}%` : ''),
      );
      hours.append(li);
    });
  }

  function renderShortcuts() {
    const list = $('#shortcuts');
    list.replaceChildren();
    for (const sc of state.shortcuts || []) {
      const taken = sc.enabled && !sc.registered;
      const li = el('li', sc.enabled && !taken ? '' : 'off');
      li.append(el('kbd', '', keys(sc.accelerator)), el('span', '', taken ? `${sc.label} (in use by another app)` : sc.label));
      list.append(li);
    }
  }

  function paintSliders() {
    for (const input of $$('input[type="range"]')) {
      const min = Number(input.min);
      const max = Number(input.max);
      const value = Number(input.value);
      const p = ((value - min) / (max - min)) * 100;
      if (input.classList.contains('centered')) {
        input.style.setProperty('--from', `${Math.min(50, p)}%`);
        input.style.setProperty('--to', `${Math.max(50, p)}%`);
      } else {
        input.style.setProperty('--fill', `${p}%`);
      }
      const output = $(`output[data-for="${input.dataset.setting}"]`);
      if (output) output.textContent = describeValue(input.dataset.setting, value);
    }
  }

  // ------------------------------------------------------------ changes

  // Coalesce rapid changes (slider drags) into one update per frame.
  let pending = {};
  let queued = false;
  function send(patch) {
    Object.assign(pending, patch);
    if (queued) return;
    queued = true;
    requestAnimationFrame(async () => {
      const patchToSend = pending;
      pending = {};
      queued = false;
      render(await api.update(patchToSend));
    });
  }

  for (const input of $$('[data-setting]')) {
    const key = input.dataset.setting;
    if (input.type === 'range') {
      input.addEventListener('pointerdown', () => {
        dragging = input;
      });
      input.addEventListener('input', () => {
        paintSliders();
        send({ [key]: Number(input.value) });
      });
    } else if (input.type === 'checkbox') {
      input.addEventListener('change', () => send({ [key]: input.checked }));
    } else {
      input.addEventListener('change', () => send({ [key]: input.value }));
    }
  }
  window.addEventListener('pointerup', () => {
    dragging = null;
  });

  $('#fps30').addEventListener('change', (event) => send({ fps: event.target.checked ? 30 : 60 }));
  $('#openAtLogin').addEventListener('change', (event) => api.command('openAtLogin', event.target.checked));
  $('#pause').addEventListener('click', () => api.command('togglePause'));
  $('#sweep').addEventListener('click', () => api.command('sweep'));
  $('#snowman').addEventListener('click', () => api.command('snowman'));
  $('#plow').addEventListener('click', () => api.command('plow'));
  $('#dock-allow').addEventListener('click', () => api.command('requestAccessibility'));
  $('#media-keys-allow').addEventListener('click', () => api.command('requestAccessibility'));
  // Turning it on asks for the permission right away if it's missing.
  $('[data-setting="mediaKeys"]').addEventListener('change', (event) => {
    if (event.target.checked) api.command('enableMediaKeys');
  });

  for (const button of $$('[data-mode]')) {
    button.addEventListener('click', () => {
      send({ mode: button.dataset.mode });
      if (button.dataset.mode === 'live' && !state.settings.location) setTimeout(() => $('#place').focus(), 60);
    });
  }
  for (const button of $$('[data-weather]')) {
    button.addEventListener('click', () => send({ mode: 'manual', weather: button.dataset.weather, paused: false }));
  }

  // ------------------------------------------------------------ wallpapers

  if (window.PanefallWallpapers) {
    for (const { id, name } of window.PanefallWallpapers.list) {
      const button = el('button');
      button.type = 'button';
      const thumb = window.PanefallWallpapers.draw(document.createElement('canvas'), id, 320, 200);
      button.append(thumb, el('span', '', name));
      button.addEventListener('click', () => {
        // Paint it at the screen's full resolution, then hand it to the app to set.
        const scale = window.devicePixelRatio || 1;
        const full = window.PanefallWallpapers.draw(document.createElement('canvas'), id, Math.round(screen.width * scale), Math.round(screen.height * scale));
        api.command('setWallpaper', { id, data: full.toDataURL('image/jpeg', 0.92) });
        $('#wall-note').textContent = `${name} is now your wallpaper ✓`;
      });
      $('#walls').append(button);
    }
  }

  // ------------------------------------------------------------ place search

  const placeInput = $('#place');
  const placeList = $('#places');
  let searchTimer = 0;
  let searchSeq = 0;

  placeInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const query = placeInput.value.trim();
    if (query.length < 2) {
      placeList.hidden = true;
      return;
    }
    searchTimer = setTimeout(async () => {
      const seq = ++searchSeq;
      const result = await api.searchPlaces(query);
      if (seq === searchSeq) showPlaces(result || {});
    }, 280);
  });

  placeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      placeInput.value = '';
      placeList.hidden = true;
    } else if (event.key === 'Enter') {
      const first = placeList.querySelector('button');
      if (first && !placeList.hidden) first.click();
    }
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.place')) placeList.hidden = true;
  });

  function showPlaces({ places = [], error }) {
    placeList.replaceChildren();
    if (error) placeList.append(el('li', 'empty', `Search failed: ${error}`));
    else if (!places.length) placeList.append(el('li', 'empty', 'No places found'));
    for (const place of places) {
      const button = el('button');
      button.type = 'button';
      button.append(el('b', '', place.name), el('small', '', [place.region, place.country].filter(Boolean).join(', ')));
      button.addEventListener('click', () => {
        placeInput.value = '';
        placeList.hidden = true;
        send({ location: place, mode: 'live', paused: false });
      });
      const li = el('li');
      li.append(button);
      placeList.append(li);
    }
    placeList.hidden = false;
  }

  // ------------------------------------------------------------ start

  if (api.onState) api.onState(render);
  api.getState().then(render);

  // ------------------------------------------------------------ browser preview

  function createPreviewApi() {
    const listeners = [];
    const reykjavik = { name: 'Reykjavík', region: 'Capital Region', country: 'Iceland', latitude: 64.14, longitude: -21.9 };
    const samplePlaces = [
      reykjavik,
      { name: 'Paris', region: 'Île-de-France', country: 'France', latitude: 48.85, longitude: 2.35 },
      { name: 'Pune', region: 'Maharashtra', country: 'India', latitude: 18.52, longitude: 73.86 },
      { name: 'Portland', region: 'Oregon', country: 'United States', latitude: 45.52, longitude: -122.68 },
      { name: 'Sapporo', region: 'Hokkaido', country: 'Japan', latitude: 43.06, longitude: 141.35 },
    ];
    let settings = {
      paused: false,
      mode: 'live',
      weather: 'snow',
      intensity: 0.35,
      wind: 0.15,
      size: 1,
      depth: 0.5,
      collectOnWindows: true,
      collectOnDock: true,
      plow: true,
      lightning: true,
      umbrella: true,
      overFullscreen: false,
      fps: 60,
      pauseOnBattery: false,
      dryWeather: 'seasonal',
      location: reykjavik,
      units: 'celsius',
      menuBarTemperature: true,
      precipitationAlerts: true,
      shortcuts: true,
      showInDock: true,
      soundOn: true,
      soundMaster: 0.6,
      soundRain: 0.7,
      soundWind: 0.5,
      soundFire: 0.3,
      soundThunder: 0.8,
      soundMatch: true,
      nowPlaying: true,
    };
    const hourly = Array.from({ length: 12 }, (_, i) => {
      const snowing = i < 5 || i > 8;
      return {
        time: `2026-11-07T${String((17 + i) % 24).padStart(2, '0')}:00`,
        temperature: -2 - i * 0.4,
        weather: snowing ? 'snow' : 'clear',
        description: snowing ? 'Light snow' : 'Overcast',
        precipitationProbability: snowing ? 80 - i * 4 : 10,
      };
    });
    const shortcuts = [
      ['Control+Alt+W', 'Pause or resume the weather'],
      ['Control+Alt+N', 'Switch to the next weather'],
      ['Control+Alt+K', 'Sweep everything away'],
      ['Control+Alt+P', 'Send the snowplow'],
      ['Control+Alt+O', 'Open the Control Center'],
    ].map(([accelerator, label]) => ({ accelerator, label, registered: true, enabled: true }));

    const build = () => {
      const live = settings.mode === 'live' && settings.location;
      return {
        preview: true,
        settings,
        scene: live ? { weather: 'snow', intensity: 0.3, wind: 0.4, live: true } : { weather: settings.weather, intensity: settings.intensity, wind: settings.wind, live: false },
        paused: settings.paused,
        onBattery: false,
        weather: settings.location
          ? {
              location: settings.location,
              units: settings.units,
              temperature: -2.4,
              description: 'Light snow',
              isDay: false,
              scene: { weather: 'snow', intensity: 0.3 },
              wind: { speed: 18, direction: 250, screen: 0.4 },
              hourly,
              fetchedAt: Date.now(),
            }
          : null,
        weatherError: null,
        accessibility: true,
        openAtLogin: true,
        canOpenAtLogin: true,
        shortcuts: shortcuts.map((s) => ({ ...s, enabled: settings.shortcuts, registered: settings.shortcuts })),
        platform: 'darwin',
        version: '0.1.0',
      };
    };

    return {
      getState: async () => build(),
      update: async (patch) => {
        settings = { ...settings, ...patch };
        return build();
      },
      command: async (name) => {
        if (name === 'togglePause') settings = { ...settings, paused: !settings.paused };
        listeners.forEach((listener) => listener(build()));
        return true;
      },
      searchPlaces: async (query) => ({
        places: samplePlaces.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
      }),
      onState: (callback) => listeners.push(callback),
    };
  }
})();
