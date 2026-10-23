# Touchline Lab

Football analysis app: team and player performance, heatmaps, shot maps, passing networks,
game states (possession phases), and side-by-side comparison of any two teams or players.

## Run
Open `dist/index.html` in a browser. No server or install needed.
After editing anything in `src/`, run `./build.sh` to rebuild `dist/index.html`.

## Layout
- `src/engine.js` – data model, demo-season simulator, StatsBomb importer, all metrics
- `src/ui.js` – views and charts (plain JS + SVG, no libraries)
- `src/style.css`, `src/head.html` – styling and page head

## Data
Everything is computed from match events with pitch coordinates (StatsBomb layout: 120 x 80 yards,
each team attacking left to right). The built-in season is synthetic. Load real StatsBomb event
files (plus the competition's matches.json) from the Data tab.
