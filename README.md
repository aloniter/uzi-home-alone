# Uzi Is Home Alone

A 40-second portrait browser game. Tap Play, drag to guide Uzi, grab treats, steal the sock, and dodge the vacuum. No install, account, or login required.

[Play the game](https://aloniter.github.io/uzi-home-alone/)

Built with HTML, Canvas 2D, and Web Audio. All assets and fonts are included, with no external runtime dependencies.

## Play locally

From this folder, run:

```bash
python3 -m http.server 8891 --bind 127.0.0.1
```

Open http://localhost:8891/. No build or package installation is needed.

## Files

- `index.html`: page, controls, and styles
- `game.js`: gameplay, rendering, and audio
- `assets/`: game art and fonts
- `meta/`: icons and social preview image
- `.nojekyll`: serve the files directly without Jekyll processing

## Deployment

GitHub Pages serves **main**, **/ (root)**. Changes published to that branch automatically update the game.

## Sharing

Share sends the score and a link containing `?s=<score>` so friends can challenge it. It tries the native share sheet, then the clipboard, then displays a link to copy. These features work best on HTTPS.

## Debugging and tuning

Add `?debug` to enable `window.__uzi`, including game state and testing controls. Debug controls are disabled on a normal link.

Tune `ROUND_TIME`, `RANKS`, Zoomies gain, and the vacuum penalty in `game.js`.
