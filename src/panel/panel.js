/*
 * The Quick Panel: a small, cozy card at the edge of the screen. A tiny live scene shows the
 * current weather (with a snowman who waves at your pointer), then weather bubbles, Play mode,
 * toys, what's playing, and cozy sounds. Opened in a plain browser it runs on sample data.
 */
(function () {
  'use strict';

  const api = window.panefall && window.panefall.getState ? window.panefall : createPreviewApi();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const NAMES = { snow: 'Snow', rain: 'Rain', storm: 'Storm', leaves: 'Leaves', blossoms: 'Blossoms', clear: 'Calm' };

  let state = null;
  let dragging = null;

  // ------------------------------------------------------------ the live scene

  const sceneBox = $('#scene');
  const engine = new window.Panefall.Engine($('#scene-canvas'));
  engine.setSettings({ weather: 'snow', intensity: 0.6, wind: 0.2, depth: 0.5, plow: false });

  function fitScene() {
    const box = sceneBox.getBoundingClientRect();
    if (!box.width) return;
    engine.resize(Math.round(box.width), Math.round(box.height), window.devicePixelRatio || 1);
    const win = $('.scene-win').getBoundingClientRect();
    engine.setWindows({
      windows: [{ id: 1, x: Math.round(win.left - box.left), y: Math.round(win.top - box.top), w: Math.round(win.width), h: Math.round(win.height) }],
      menubars: [],
      dock: null,
    });
  }
  fitScene();
  for (let i = 0; i < 40 * 30; i++) engine.step(1 / 30); // start with snow already settled
  engine.buildSnowman({ x: 34, y: sceneBox.clientHeight - 6 });
  engine.snowmen.forEach((m) => {
    m.scale = 1.25;
    m.age = 5; // already built
  });
  new ResizeObserver(fitScene).observe(sceneBox);
  sceneBox.addEventListener('pointermove', (event) => {
    const box = sceneBox.getBoundingClientRect();
    engine.setPointer({ x: event.clientX - box.left, y: event.clientY - box.top });
  });
  sceneBox.addEventListener('pointerleave', () => engine.setPointer(null));

  let last = performance.now();
  (function frame(now) {
    requestAnimationFrame(frame); // pauses by itself while the panel is hidden
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    engine.step(dt);
    engine.draw();
    // The snowman is the panel's mascot: always there, whatever the weather, and he never melts.
    if (!engine.snowmen.length) engine.buildSnowman({ x: 34, y: sceneBox.clientHeight - 6 });
    for (const m of engine.snowmen) m.melt = 0;
  })(last);

  // ------------------------------------------------------------ rendering

  function render(next) {
    if (!next) return;
    state = next;
    const s = state.settings;

    $('#pause').textContent = s.paused ? '▶️' : '⏸';
    $('#place').textContent = state.weather ? `${state.weather.location.name} · ${Math.round(state.weather.temperature)}°` : 'Panefall';
    const weather = state.scene.weather;
    if (weather !== engine.settings.weather) engine.setSettings({ weather, intensity: Math.max(0.45, state.scene.intensity || 0) });

    for (const b of $$('[data-weather]')) b.setAttribute('aria-pressed', String(s.mode === 'manual' && s.weather === b.dataset.weather));
    $('#live').setAttribute('aria-pressed', String(s.mode === 'live'));
    $('#weather-name').textContent = s.paused ? 'Paused' : state.scene.live ? `${NAMES[weather]} · live` : NAMES[weather];

    for (const input of $$('[data-setting]')) {
      if (input === dragging) continue;
      const value = s[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    $('#intensity').disabled = s.mode === 'live' && Boolean(state.weather);
    paintSliders();

    const play = $('#play');
    play.classList.toggle('on', Boolean(state.playMode));
    play.textContent = state.playMode ? '✋ Stop playing (esc)' : '🧤 Play with the weather';

    renderMusic(state.nowPlaying);
  }

  function renderMusic(np) {
    $('#music').hidden = state.platform !== 'darwin' || !state.settings.nowPlaying;
    $('#music').classList.toggle('playing', Boolean(np && np.playing !== false));
    $('#art').dataset.source = np ? np.source : '';
    $('#track-title').textContent = np ? np.title : 'Nothing playing';
    $('#track-artist').textContent = np ? np.artist || np.source : 'Play music in an app or a browser tab';
    $('#track-source').textContent = np ? (np.kind === 'browser' ? `${np.source} · ${np.app.replace(' Browser', '')}` : np.source) : '';
    // Browser music: play/pause/skip works through the media keys once the user turns it on.
    const browser = Boolean(np && np.kind === 'browser');
    const canControl = !browser || (state.settings.mediaKeys && state.accessibility);
    $('#transport').hidden = !np || !canControl;
    $('#browser-actions').hidden = !browser;
    $('#enable-keys').hidden = !browser || canControl;
    $('#enable-keys').textContent = state.settings.mediaKeys ? '🔓 Allow control…' : '🎛 Control it from here';
    $('#playpause').textContent = browser ? '⏯' : np && np.playing ? '⏸' : '▶️';
  }

  function paintSliders() {
    for (const input of $$('input[type="range"]')) {
      const p = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      input.style.setProperty('--fill', `${p}%`);
    }
  }

  // ------------------------------------------------------------ actions

  let pending = {};
  let queued = false;
  function send(patch) {
    Object.assign(pending, patch);
    if (queued) return;
    queued = true;
    requestAnimationFrame(async () => {
      const toSend = pending;
      pending = {};
      queued = false;
      render(await api.update(toSend));
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
    } else {
      input.addEventListener('change', () => send({ [key]: input.checked }));
    }
  }
  window.addEventListener('pointerup', () => {
    dragging = null;
  });

  for (const button of $$('[data-weather]')) {
    button.addEventListener('click', () => send({ mode: 'manual', weather: button.dataset.weather, paused: false }));
  }
  $('#live').addEventListener('click', () => {
    if (state.settings.location) send({ mode: 'live', paused: false });
    else api.command('openControlCenter'); // pick a city there first
  });
  for (const button of $$('[data-command]')) {
    button.addEventListener('click', () => {
      api.command(button.dataset.command);
      // A taste of it right here in the panel, too.
      const toy = button.dataset.command;
      if (toy === 'snowman') engine.buildSnowman({ x: 40 + Math.random() * (engine.width - 80), y: engine.height - 6 });
      else if (toy === 'snowball') engine.throwSnowball(null);
      else if (toy === 'gust') engine.gust();
      else if (toy === 'thunder') engine.thunder();
      else if (toy === 'sweep') engine.clearAll();
    });
  }
  for (const button of $$('[data-media]')) button.addEventListener('click', () => api.command('media', button.dataset.media));
  $('#go-tab').addEventListener('click', () => api.command('media', 'show'));
  $('#enable-keys').addEventListener('click', () => api.command('enableMediaKeys'));
  $('#close').addEventListener('click', () => api.command('hidePanel'));
  $('#play').addEventListener('click', () => api.command('play'));
  $('#pause').addEventListener('click', () => api.command('togglePause'));
  $('#open-control').addEventListener('click', () => api.command('openControlCenter'));
  $('#quit').addEventListener('click', () => api.command('quit'));

  // Everything pops in each time the panel opens.
  function enter() {
    const panel = $('#panel');
    panel.classList.remove('enter');
    void panel.offsetWidth;
    panel.classList.add('enter');
  }
  if (api.onPanelShown) api.onPanelShown(enter);
  enter();

  if (api.onState) api.onState(render);
  api.getState().then(render);

  // ------------------------------------------------------------ browser preview

  function createPreviewApi() {
    const listeners = [];
    let settings = { paused: false, mode: 'manual', weather: 'snow', intensity: 0.5, location: { name: 'San Jose' }, soundOn: true, soundMaster: 0.6, nowPlaying: true };
    let playMode = false;
    const build = () => ({
      preview: true,
      settings,
      scene: { weather: settings.mode === 'live' ? 'rain' : settings.weather, intensity: settings.intensity, live: settings.mode === 'live' },
      weather: { location: settings.location, temperature: 73 },
      nowPlaying: { kind: 'browser', source: 'YouTube', app: 'Brave Browser', title: 'Tum Hi Ho', artist: 'Arijit Singh', playing: null },
      playMode,
      platform: 'darwin',
    });
    const emit = () => listeners.forEach((listener) => listener(build()));
    return {
      getState: async () => build(),
      update: async (patch) => {
        settings = { ...settings, ...patch };
        return build();
      },
      command: async (name) => {
        if (name === 'togglePause') settings = { ...settings, paused: !settings.paused };
        if (name === 'play') playMode = !playMode;
        emit();
        return true;
      },
      onState: (callback) => listeners.push(callback),
    };
  }
})();
