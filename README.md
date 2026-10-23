# Touchline Lab

Football analysis app: team and player performance, heatmaps, shot maps, passing networks,
game states (possession phases), formations and tactical line-ups, and side-by-side comparison of any two teams or players.

## Run
Open `dist/index.html` in a browser. No server or install needed.
After editing anything in `src/`, run `./build.sh` to rebuild `dist/index.html`.

`./build.sh --with-snapshot out.html` also embeds the files listed in `data/snapshot/manifest.json`
(a season file plus FBref tables), so the page opens on that real data instead of the synthetic
demo season. `data/snapshot/` is not in the repository: it holds third-party data
(football-data.co.uk, FBref) that is only bundled into the private published copy.

Imported files and pasted FBref tables are saved in the browser (IndexedDB, nothing uploaded) and
restored when the app is opened again; "Forget saved data" in the Data tab clears them. Saved data
belongs to that browser on that device.

## Layout
- `src/engine.js` – data model, demo-season simulator, StatsBomb importer, all metrics
- `src/ui.js` – views and charts (plain JS + SVG, no libraries)
- `src/tactics.js` – Tactics tab: formations, tactical line-up board, shape numbers
- `src/apifootball.js` – API-Football importer (match/player stats, line-ups, formations)
- `src/footballdata.js` – football-data.co.uk CSV importer (results, team match stats, odds)
- `src/fbref.js` – FBref player table importer (season totals per player)
- `src/opponents.js` – Opponents tab: record against each club, this season and all-time
- `src/store.js` – saves imports in the browser and restores them on open; built-in snapshot
- `tools/embed-snapshot.mjs` – used by `build.sh --with-snapshot`
- `tools/fetch-api-football.mjs` – downloads a season from API-Football into one file
- `src/style.css`, `src/head.html` – styling and page head

## Data
The built-in season is synthetic. Three kinds of real data can be loaded from the Data tab:

**football-data.co.uk CSV** (free, no key, current season). Results, xG (recent seasons), shots,
shots on target, corners, fouls, cards and bookmaker odds for every match, one file per league season. The
Scottish Premiership file for 2026/27 is https://www.football-data.co.uk/mmz4281/2627/SC0.csv
(the folder is the two season years, e.g. 2526 for 2025/26). Download it in a browser and drop it
in. The odds become "market expected points", shown next to actual points in the league table.
No players, line-ups or pitch locations, so Players, Tactics and the pitch maps stay empty.

**FBref player tables** (season totals per player). Add them on top of a loaded season: on a squad
page (e.g. https://fbref.com/en/squads/8bbab7cf/Aberdeen-Stats) use Share & Export > Get table as
CSV, or copy the table itself, and paste it into the Data tab's FBref box (or drop a saved .csv).
Standard Stats gives appearances, minutes, goals, assists and cards; Shooting adds shots and shots
on target; Goalkeeping adds saves, save % and clean sheets; Playing Time adds team goal difference
while on the pitch and points per match. (FBref dropped its xG and progression columns for 2026/27;
they are read if present.) The team's **Scores & Fixtures** table adds each match's formations,
possession, attendance and referee, matched to the loaded season by date and opponent, plus the
upcoming fixtures. The **Records vs Opponents** table adds all-time head-to-head records, shown in
the Opponents tab. Columns are matched by name, so FBref layout changes are tolerated. Add several
teams to get league-wide percentiles. FBref blocks automated downloads, so this is copy-and-paste by
design.

**StatsBomb event data** (every pass, shot and tackle with pitch coordinates, 120 x 80 yards,
each team attacking left to right). Drives every view, including heatmaps and passing networks.
Drop the event files plus the competition's matches.json.

**API-Football** (results, line-ups, formations, team and player match stats, xG where the feed
has it; no pitch coordinates). Covers the Scottish Premiership, so this is the route to real
Aberdeen data. Pitch maps stay empty with this source.

```sh
# Node 18+, free key from https://dashboard.api-football.com
API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --season 2024   # 2024 = 2024/25
API_FOOTBALL_KEY=your_key node tools/fetch-api-football.mjs --find "Premiership"  # look up league ids
```

League 179 (Scottish Premiership) is the default. The free plan covers seasons 2022 to 2024 only and
fetches one match per request (100 requests a day), so a full season takes about three daily runs.
Re-run the same command each day: Aberdeen's matches come first, downloaded matches are cached in
`api-football-cache/`, and the league table is complete from the first run. Paid plans fetch 20
matches per request. Then drop the saved `api-football-179-<season>.json` into the Data tab.
If players look mirrored left/right on the Tactics board, flip `AF_GRID_COL1_LEFT` in
`src/apifootball.js` and rebuild.
