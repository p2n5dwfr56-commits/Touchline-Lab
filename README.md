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
- `src/sportmonks.js` – Sportmonks importer (line-ups, events, player match stats), added on top of a season
- `src/pressing.js` – Without the ball tab: ball winning, losses of the ball, time to win it back, 360 positions
- `src/assessment.js` – Key players tab: position-based player ratings, squad leaders, season improvement
- `src/seasons.js` – past seasons: season picker, Seasons tab (season by season, points race, players across seasons)
- `src/opponents.js` – Opponents tab: record against each club, this season and all-time
- `src/store.js` – saves imports in the browser and restores them on open; built-in snapshot
- `tools/embed-snapshot.mjs` – used by `build.sh --with-snapshot`
- `tools/fetch-api-football.mjs` – downloads a season from API-Football into one file
- `tools/fetch-sportmonks.mjs` – downloads a Sportmonks season into one file
- `tools/fetch-statsbomb.mjs` – downloads StatsBomb Open Data matches (events + 360) into one file
- `src/style.css`, `src/head.html` – styling and page head

## Data
The built-in season is synthetic. Several kinds of real data can be loaded from the Data tab:

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
upcoming fixtures. Rows from other competitions (League Cup, Scottish Cup, Europe) become cup
matches: results, round, venue (including neutral), penalties, formations, possession and match
info, with no team match stats. Cup ties FBref does not list can be entered in the Data tab's
**Add a match** form (played, with a score, or upcoming, without one); they are saved with the
other imports. A Competition filter (All / League / Cups) appears once a team has cup matches; it
applies to results, form, matches, formations and opponents, while the league table, rankings and
team stats stay league-only. The **Records vs Opponents** table adds all-time head-to-head records, shown in
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

**Sportmonks** (current season, free plan covers the Scottish Premiership; no League Cup, no xG,
no pitch coordinates). Adds, on top of a loaded season file, every match's line-ups with positions,
formations, goals, assists, cards, substitutions and per-player match stats (minutes, passes, key
passes, tackles, duels, dribbles, saves, match rating) for every club, plus the remaining fixtures.
Players are matched to FBref names where both are loaded.

```sh
# Node 18+, token from https://my.sportmonks.com (API tokens)
SPORTMONKS_TOKEN=your_token node tools/fetch-sportmonks.mjs   # league 501, current season
```

Load the football-data.co.uk CSV first, then drop the saved `sportmonks-501-<season>.json` into
the Data tab. Matches are paired by teams and date. Re-run after each round for new matches. The
free plan allows 180 requests an hour; a season takes about 10.

## Without the ball
The **Without the ball** tab has two parts.

**Ball winning** works with any source that has tackles and interceptions (Sportmonks, API-Football,
StatsBomb): a league table of ball wins (tackles + interceptions + recoveries), duels, fouls,
opponent pass completion and opponent passes per defensive action, ball wins by match, and each
player's ball wins per 90 with a league percentile.

**After losing the ball** needs event data with locations. A loss is counted event by event: a
team has the ball and the next team to control it is the opponent, with no stoppage in between
(a ball that goes out is not a loss, and shots are not counted). For each loss it records where it
happened, how long it took to win the ball back, and whether the opponent had a shot within 20
seconds. With StatsBomb 360 data it also shows where every player in the camera's view was at the
moment of the loss: team-mates behind the ball and within 10 yards. (360 data includes only players
in the broadcast view, so counts of players far from the ball run low.) No free source has this
for the Scottish Premiership, so the snapshot build includes StatsBomb's Euro 2024 Group A
(Scotland, Germany, Hungary, Switzerland) as a sample.

```sh
node tools/fetch-statsbomb.mjs --list                          # competitions; [360] marks player positions
node tools/fetch-statsbomb.mjs --competition 55 --season 282    # Euro 2024, all 51 matches
```

Drop the saved file into the Data tab. Event data is shown for that visit and not saved, so saved
season data stays. For the snapshot build, the sample comes from `data/sample/` via the
manifest's `sample` entry. Data: [StatsBomb Open Data](https://github.com/statsbomb/open-data).

## Key players
Rates every player against league players in the same position (goalkeeper, defender, midfielder,
forward), per 90 minutes, on whatever stats the data has: goals, creating (key passes, big chances,
dribbles), passing, defending (tackles won, interceptions, recoveries, clearances, blocks), duels and
headers won, ball security (possession lost, dispossessed, errors) and team impact (goal difference
while on, points per match, match rating). Each area is an average of percentiles; areas are weighted
by position into a performance score, and importance = performance × (0.4 + 0.6 × share of minutes).
Players with few minutes are pulled towards average. The tab also lists squad leaders, results with and
without each starter, and **season improvement**: each player's early matches against his recent ones
for match rating or a chosen stat, with a match-by-match trend and 3-match rolling average.

## Seasons
Earlier seasons sit beside the current one. Drop a past season's football-data.co.uk file
(e.g. https://www.football-data.co.uk/mmz4281/2425/SC0.csv) into the Data tab and it is saved as a
past season, leaving the current season as it is. Add line-ups and player stats for it with
Sportmonks (`node tools/fetch-sportmonks.mjs --list-seasons`, then `--season <id>`). The free plan has
full player stats from 2019/20; 2017/18 and 2018/19 have minutes, goals, assists and cards only.
Pick a season with **Season** at the top to see it in every tab. The **Seasons** tab compares them:
position (with the split after 33 rounds), points, market expected points, goals and shots by season,
a points race of this season against earlier ones, and players' numbers season by season.

Snapshot builds embed past seasons from `data/snapshot/past/` via the manifest's `past` list
(`{season, files, layers}`); unused CSV columns and Sportmonks stat types are dropped to keep the page small.
