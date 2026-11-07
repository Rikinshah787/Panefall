# Contributing to Panefall

Thanks for wanting to help! Panefall is a small, friendly codebase: plain JavaScript, no frameworks, one native helper in Swift. You can usually find what you need in a few minutes.

## Run it

You need macOS with Xcode Command Line Tools (`xcode-select --install`) and Node.js 20 or later.

```sh
git clone https://github.com/Rikinshah787/Panefall.git
cd Panefall
npm install
npm start
```

`npm start` builds the native window helper and a dev copy of the app named Panefall (`build/Panefall.app`), then launches it.

## Where things live

| Path | What it is |
| --- | --- |
| `src/renderer/sim.js` | The weather engine: particles, piles, beads on glass, snowmen, the umbrella cursor. No Electron in it. |
| `src/renderer/sound.js` | Ambient sound, synthesized with Web Audio |
| `src/main/main.js` | App lifecycle, overlays, Quick Panel, Control Center, menu bar, shortcuts |
| `src/main/weather.js` | Live weather from Open-Meteo |
| `src/main/media.js` | Now playing for Music and Spotify |
| `src/control/`, `src/panel/` | The Control Center and the Quick Panel |
| `native/mac/WindowTracker.swift` | Reports where windows are |
| `docs/` | The website (GitHub Pages), which runs a copy of the engine |

## Handy while developing

- **Work on the engine in a browser.** Run `npm run demo` and open <http://127.0.0.1:4321/src/renderer/>. You get a fake desktop with draggable windows. Keys 1–6 switch weather; M, B, G and T build a snowman, throw a snowball, blow a gust and call thunder. `window.panefallEngine` is available in the console.
- **Work on the UI in a browser.** `/src/control/` and `/src/panel/` run with built-in sample data.
- **See what the app draws.** Run `PANEFALL_DEBUG_DIR=/tmp/panefall npm start` and it saves images of every overlay, the Control Center and the Quick Panel, plus the engine's state, every 10 seconds.
- **After changing the engine,** run `npm run site` so the website gets the same code.
- **To refresh the README animations,** open `/scripts/demo-recorder.html` (or `?scene=snowman`). The steps are at the top of `scripts/demo-recorder.js`.

## Before you open a pull request

- Run `npm start` and try your change for real, in both light and dark mode, and with more than one display if you can.
- Keep it light on battery. The weather runs all day, so check that idle CPU stays low.
- Keep the code style: small functions, clear names, and comments that explain *why*.
- If you add a setting, add it to `src/main/settings.js` (default and validation) and to the Control Center.
- Describe what you changed and how you tested it. Screenshots or a short clip are great.

## Good first contributions

- **The Windows tracker.** Port `native/mac/WindowTracker.swift` to Windows (EnumWindows + DWM frame bounds, plus the taskbar). It should emit the same report as `src/main/mac-tracker.js`: `{ windows: [{ id, x, y, w, h }] front to back, menubars, dock }`. Everything else is shared.
- **A new kind of weather.** Fog, hail or northern lights: see how `leaves` and `blossoms` are added in `sim.js`.
- **Anything in the README's "Ideas we're exploring".**

Open an issue first for anything big, so we can agree on the approach before you put in the time.

## License

By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).
