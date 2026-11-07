/*
 * The Quick Panel: a slim panel at the right edge of the screen for the things you reach for
 * often: weather, toys (snowman, snowball, gust, thunder, plow, sweep), ambient sound and the
 * music that's playing. Opened in a plain browser it runs against a built-in preview.
 */
(function () {
  'use strict';

  const api = window.panefall && window.panefall.getState ? window.panefall : createPreviewApi();
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const VERBS = { snow: 'Snowing', rain: 'Raining', storm: 'Storming', leaves: 'Leaves falling', blossoms: 'Blossoms drifting', clear: 'Calm' };

  let state = null;
  let dragging = null;

  function render(next) {
    if (!next) return;
    state = next;
    const s = state.settings;
    document.documentElement.classList.toggle('preview', Boolean(state.preview));

    $('#pause').classList.toggle('paused', s.paused);
    $('#pause-icon').setAttribute('href', s.paused ? '#i-resume' : '#i-pause');
    $('#status').textContent = statusLine();

    for (const b of $$('[data-weather]')) b.setAttribute('aria-pressed', String(s.mode === 'manual' && s.weather === b.dataset.weather));
    const live = $('#live');
    live.setAttribute('aria-pressed', String(s.mode === 'live'));
    $('#live-label').textContent = s.location
      ? state.weather
        ? `Real weather · ${state.weather.location.name} ${Math.round(state.weather.temperature)}°`
        : `Real weather · ${s.location.name}`
      : 'Follow the real weather…';

    for (const input of $$('[data-setting]')) {
      if (input === dragging) continue;
      const value = s[input.dataset.setting];
      if (input.type === 'checkbox') input.checked = Boolean(value);
      else input.value = String(value);
    }
    $('[data-setting="intensity"]').disabled = s.mode === 'live' && Boolean(state.weather);
    $('#mixer').classList.toggle('off', !s.soundOn);
    paintSliders();

    $('#music').hidden = state.platform !== 'darwin' || !s.nowPlaying;
    const np = state.nowPlaying;
    const art = $('#art');
    art.className = `art ${np ? (np.player === 'Spotify' ? 'spotify' : '') : 'idle'}`;
    $('#track-title').textContent = np ? np.title : 'Nothing playing';
    $('#track-artist').textContent = np ? `${np.artist} · ${np.player === 'Music' ? 'Apple Music' : np.player}` : 'Play something in Music or Spotify';
    $('#play-icon').setAttribute('href', np && np.state === 'playing' ? '#i-pause' : '#i-play');
  }

  function statusLine() {
    const s = state.settings;
    if (s.paused) return 'Paused';
    if (state.paused) return 'Paused while on battery';
    const verb = VERBS[state.scene.weather] || 'Calm';
    return state.scene.live && state.weather ? `${verb} · live` : verb;
  }

  function paintSliders() {
    for (const input of $$('input[type="range"]')) {
      const p = ((Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      input.style.setProperty('--fill', `${p}%`);
    }
  }

  // Coalesce slider drags into one update per frame.
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
    button.addEventListener('click', () => api.command(button.dataset.command));
  }
  for (const button of $$('[data-media]')) {
    button.addEventListener('click', () => api.command('media', button.dataset.media));
  }
  $('#pause').addEventListener('click', () => api.command('togglePause'));
  $('#open-control').addEventListener('click', () => api.command('openControlCenter'));
  $('#quit').addEventListener('click', () => api.command('quit'));

  // Replay the slide-in each time the panel opens.
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
    let settings = {
      paused: false,
      mode: 'manual',
      weather: 'snow',
      intensity: 0.45,
      location: { name: 'Reykjavík', country: 'Iceland', latitude: 64.1, longitude: -21.9 },
      soundOn: true,
      soundMaster: 0.6,
      soundRain: 0.7,
      soundWind: 0.5,
      soundFire: 0.4,
      soundThunder: 0.8,
      soundMatch: true,
      nowPlaying: true,
    };
    let playing = true;
    const build = () => ({
      preview: true,
      settings,
      scene: { weather: settings.mode === 'live' ? 'snow' : settings.weather, live: settings.mode === 'live' },
      paused: settings.paused,
      weather: { location: settings.location, temperature: -2.4 },
      nowPlaying: { player: 'Music', state: playing ? 'playing' : 'paused', title: 'Snowfall', artist: 'Øneheart & reidenshi' },
      platform: 'darwin',
    });
    const emit = () => listeners.forEach((listener) => listener(build()));
    return {
      getState: async () => build(),
      update: async (patch) => {
        settings = { ...settings, ...patch };
        return build();
      },
      command: async (name, arg) => {
        if (name === 'togglePause') settings = { ...settings, paused: !settings.paused };
        if (name === 'media' && arg === 'playpause') playing = !playing;
        emit();
        return true;
      },
      onState: (callback) => listeners.push(callback),
    };
  }
})();
