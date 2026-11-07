// "Now playing" for the Quick Panel, from apps and browsers (macOS, via AppleScript):
//   - Music and Spotify: the current track, with play / pause / next / previous.
//   - Chrome, Brave, Edge, Arc and Safari: the music tab you have open (YouTube, YouTube Music,
//     Spotify, SoundCloud, Apple Music, JioSaavn, …), and a click takes you to that tab.
// It only talks to apps that are already running, so it never launches one. The first time,
// macOS asks whether Panefall may control each app.
const { execFile } = require('child_process');

const PLAYERS = ['Spotify', 'Music'];
const BROWSERS = [
  { app: 'Brave Browser', chromium: true },
  { app: 'Google Chrome', chromium: true },
  { app: 'Microsoft Edge', chromium: true },
  { app: 'Arc', chromium: true },
  { app: 'Safari', chromium: false },
];
// Music sites, best first, with the bit of the tab title to strip off.
const SITES = [
  { host: 'music.youtube.com', label: 'YouTube Music', strip: / - YouTube Music$/ },
  { host: 'open.spotify.com', label: 'Spotify', strip: / \| Spotify.*$/ },
  { host: 'soundcloud.com', label: 'SoundCloud', strip: / \| (Listen online|Free Listening).*$/i },
  { host: 'music.apple.com', label: 'Apple Music', strip: / (on|-) Apple Music$/ },
  { host: 'jiosaavn.com', label: 'JioSaavn', strip: / - (Download|Listen).*$/i },
  { host: 'gaana.com', label: 'Gaana', strip: / - .*Gaana.*$/i },
  { host: 'wynk.in', label: 'Wynk', strip: / - Wynk.*$/i },
  { host: 'music.amazon', label: 'Amazon Music', strip: / \| Amazon Music.*$/i },
  { host: 'deezer.com', label: 'Deezer', strip: / - Deezer$/ },
  { host: 'tidal.com', label: 'TIDAL', strip: / on TIDAL$/ },
  { host: 'youtube.com/watch', label: 'YouTube', strip: / - YouTube$/ },
];
const COMMANDS = { playpause: 'playpause', next: 'next track', previous: 'previous track' };

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

const osascript = (script) => run('/usr/bin/osascript', ['-e', script]);

async function runningApps() {
  if (process.platform !== 'darwin') return new Set();
  try {
    return new Set((await run('/bin/ps', ['-axco', 'command'])).split('\n').map((line) => line.trim()));
  } catch {
    return new Set();
  }
}

async function fromPlayer(player) {
  const out = (
    await osascript(
      [
        `tell application "${player}"`,
        '  if player state is playing or player state is paused then',
        '    return (player state as text) & linefeed & (name of current track) & linefeed & (artist of current track)',
        '  end if',
        'end tell',
      ].join('\n'),
    )
  ).trim();
  if (!out) return null;
  const [state, title, artist] = out.split('\n');
  return { source: player === 'Music' ? 'Apple Music' : player, kind: 'player', app: player, playing: state === 'playing', title, artist };
}

/** "(3) Song Name - Artist - YouTube" -> { title: "Song Name", artist: "Artist" } */
function parseTitle(raw, site) {
  let text = raw.replace(/^\(\d+\)\s*/, '').replace(/^[▶►]\s*/, '').replace(site.strip, '').trim();
  let artist = '';
  for (const separator of [' • ', ' · ', ' — ', ' - ', ' by ']) {
    const i = text.indexOf(separator);
    if (i > 0) {
      artist = text.slice(i + separator.length).trim();
      text = text.slice(0, i).trim();
      break;
    }
  }
  // Spotify's player shows "Song • Artist"; YouTube music videos are usually "Artist - Song".
  if (site.label === 'YouTube' && artist) [text, artist] = [artist, text];
  return { title: text || raw, artist };
}

async function fromBrowser({ app, chromium }) {
  const name = chromium ? 'title of t' : 'name of t';
  const out = await osascript(
    [
      'set out to ""',
      `tell application "${app}"`,
      '  set wi to 0',
      '  repeat with w in windows',
      '    set wi to wi + 1',
      '    set ti to 0',
      '    repeat with t in tabs of w',
      '      set ti to ti + 1',
      `      set out to out & wi & tab & ti & tab & (URL of t) & tab & (${name}) & linefeed`,
      '    end repeat',
      '  end repeat',
      'end tell',
      'return out',
    ].join('\n'),
  );
  let best = null;
  for (const line of out.split('\n')) {
    const [window, tabIndex, url = '', title = ''] = line.split('\t');
    const rank = SITES.findIndex((s) => url.includes(s.host));
    if (rank < 0 || (best && best.rank <= rank)) continue;
    best = { rank, window: Number(window), tab: Number(tabIndex), title, site: SITES[rank] };
  }
  if (!best) return null;
  return {
    source: best.site.label,
    kind: 'browser',
    app,
    window: best.window,
    tab: best.tab,
    playing: null, // browsers don't say whether a tab is playing
    ...parseTitle(best.title, best.site),
  };
}

/** What's playing (or open to play), or null. */
async function nowPlaying() {
  const running = await runningApps();
  for (const player of PLAYERS) {
    if (!running.has(player)) continue;
    try {
      const found = await fromPlayer(player);
      if (found) return found;
    } catch {
      // not allowed yet, or between tracks
    }
  }
  for (const browser of BROWSERS) {
    if (!running.has(browser.app)) continue;
    try {
      const found = await fromBrowser(browser);
      if (found) return found;
    } catch {
      // not allowed yet
    }
  }
  return null;
}

/** action: 'playpause' | 'next' | 'previous' for players, or 'show' to jump to a browser tab. */
async function control(action, current) {
  if (!current) return false;
  try {
    if (current.kind === 'browser') {
      // Browsers can't be told to pause a tab, so the card takes you to the tab instead.
      const select = current.app === 'Safari' ? `set current tab of window ${current.window} to tab ${current.tab} of window ${current.window}` : `set active tab index of window ${current.window} to ${current.tab}`;
      await osascript(`tell application "${current.app}"\n${select}\nset index of window ${current.window} to 1\nactivate\nend tell`);
      return true;
    }
    if (!COMMANDS[action]) return false;
    await osascript(`tell application "${current.app}" to ${COMMANDS[action]}`);
    return true;
  } catch {
    return false;
  }
}

module.exports = { nowPlaying, control, parseTitle };
