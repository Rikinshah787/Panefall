// "Now playing" for the Quick Panel: reads and controls Apple Music or Spotify with
// AppleScript (macOS only). It only talks to a player that is already running, so it never
// launches one; the first time, macOS asks whether Panefall may control that app.
const { execFile } = require('child_process');

const PLAYERS = ['Spotify', 'Music']; // checked in this order
const COMMANDS = { playpause: 'playpause', next: 'next track', previous: 'previous track' };

function run(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 4000 }, (err, stdout) => (err ? reject(err) : resolve(String(stdout))));
  });
}

async function runningPlayers() {
  if (process.platform !== 'darwin') return [];
  try {
    const processes = new Set((await run('/bin/ps', ['-axco', 'command'])).split('\n').map((line) => line.trim()));
    return PLAYERS.filter((name) => processes.has(name));
  } catch {
    return [];
  }
}

/** { player, state: 'playing' | 'paused', title, artist } or null when nothing is playing. */
async function nowPlaying() {
  for (const player of await runningPlayers()) {
    const script = [
      `tell application "${player}"`,
      '  if player state is playing or player state is paused then',
      '    return (player state as text) & linefeed & (name of current track) & linefeed & (artist of current track)',
      '  end if',
      'end tell',
    ].join('\n');
    try {
      const out = (await run('/usr/bin/osascript', ['-e', script])).trim();
      if (!out) continue;
      const [state, title, artist] = out.split('\n');
      return { player, state, title, artist };
    } catch {
      // Not allowed yet, or the player is between tracks: try the next one.
    }
  }
  return null;
}

/** action: 'playpause' | 'next' | 'previous'. Returns false when no player is running. */
async function control(action) {
  const command = COMMANDS[action];
  if (!command) return false;
  const current = await nowPlaying();
  const player = current ? current.player : (await runningPlayers())[0];
  if (!player) return false;
  try {
    await run('/usr/bin/osascript', ['-e', `tell application "${player}" to ${command}`]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { nowPlaying, control };
