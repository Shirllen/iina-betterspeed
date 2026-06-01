# iina-betterspeed

`iina-betterspeed` started as an attempt to bring PotPlayer's familiar `z` key
speed switch behavior to IINA, and now also supports a hold-to-temporarily-speed-up
workflow.

GitHub repository:

- `https://github.com/Shirllen/iina-betterspeed`

This repository keeps the plugin source directly at the repository root, which
matches the structure used by most simple IINA plugins and works cleanly with
IINA's GitHub installer.

Source files:

- `Info.json`
- `main.js`
- `preferences.html`
- `scripts/build-package.sh`

## Behavior

### Toggle shortcut

- If current speed is not `1.0x`, pressing the shortcut stores that speed and switches to `1.0x`.
- If current speed is `1.0x`, pressing the shortcut switches back to the last remembered non-`1.0x` speed.
- If no non-`1.0x` speed has been remembered yet, it toggles between `1.0x` and the fallback speed, which defaults to `2.0x`.

### Temporary speed key

- A quick tap on `SPACE` pauses or resumes playback directly from the plugin.
- Holding the key briefly switches to a temporary playback speed, which defaults to `2.0x`.
- Releasing the key restores the speed that was active before you held it down.
- IINA sends menu shortcuts to itself before plugin listeners run. To use the default `SPACE` tap/hold behavior, first remove or remap IINA's own `SPACE` shortcut in `Settings > Key Bindings`; BetterSpeed will then provide tap-to-pause and hold-to-speed-up on `SPACE` by itself.
- If you remap this feature to another key, that key's original long-press or repeat behavior is no longer preserved, because BetterSpeed takes over the hold gesture. If the key is still bound to an IINA command, BetterSpeed cannot intercept it until you remap that IINA shortcut too.

The plugin also listens for normal speed changes in IINA and remembers the most
recent non-`1.0x` value, even if you changed it outside the plugin action.

## Install

### From GitHub

In IINA, use the plugin installer and enter:

`https://github.com/Shirllen/iina-betterspeed`

### From Releases

Download the latest `.iinaplgz` asset from:

`https://github.com/Shirllen/iina-betterspeed/releases`

Then open the file in IINA or install it from the plugin installer UI.

### From Source

Build the installable package locally:

```bash
./scripts/build-package.sh
```

The script creates:

`dist/iina-betterspeed-<version>.iinaplgz`

Even though the repository source lives at the root, the packaged archive still
contains the expected `iina-betterspeed.iinaplugin` directory for installation.

## Configure

Open IINA plugin settings for `BetterSpeed` and adjust:

- `Toggle shortcut key`
- `Fallback toggle speed`
- `Temporary speed key`
- `Temporary speed`

Defaults:

- Toggle shortcut: `z`
- Fallback toggle speed: `2.0`
- Temporary speed key: `SPACE`
- Temporary speed: `2.0`

Before using the default `SPACE` hold behavior, remove or remap IINA's own
`SPACE` shortcut in `Settings > Key Bindings`. This is required by IINA's
current input handling order.

## Limitation

IINA's current plugin API lets plugins register menu items with shortcuts, but
it does not expose plugin-defined actions inside the built-in `Key Bindings`
action list.

## Release Maintenance

- The plugin metadata uses `ghRepo` and `ghVersion`, which is the standard IINA GitHub update path.
- Keep release artifacts out of the main branch and upload the built `.iinaplgz` file to GitHub Releases instead.
- When publishing a new plugin version, update `version`, increment `ghVersion`, run `./scripts/build-package.sh`, then create or update the matching GitHub release with the file from `dist/`.
