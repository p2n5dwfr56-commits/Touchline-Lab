# Scheduled results update

A scheduled task starts a fresh cloud session every evening that follows these steps. It only does
the full work when a Premiership match has finished since the data's date.

- Touchline Lab (the page): https://claude.ai/artifact/Bb8uEQNpi6Egy8TN5V6C5w
- Data store (the files in `data/snapshot/`, which stay out of git): https://claude.ai/artifact/3S5U7wZkrUz1Dm1i1EAmeB
- Needs the environment variable `SPORTMONKS_TOKEN` (set in the cloud environment's settings, never in a file).

## Steps

1. **Repository.** Work in the Touchline-Lab checkout (`p2n5dwfr56-commits/Touchline-Lab`). If the session
   has none, attach it with `add_repo` and clone it. All commands below run from its root.
2. **Token.** If `SPORTMONKS_TOKEN` is empty, stop and say: "Scheduled update skipped: add SPORTMONKS_TOKEN
   to the environment settings." Never ask for the token in the conversation.
3. **Anything new?** Read `manifest.json` from the data store (`Artifact` action `read`, `url` = data store,
   `path` = `manifest.json`), copy it to `data/snapshot/manifest.json`, then run `tools/refresh.sh --check`.
   Exit code 10 means no match has finished since the data's date: stop, with one line saying so.
4. **Restore the data.** List the data store's files (`Artifact` action `list`, `scope` `files`) and read them
   all in one call (`action` `read`, `paths` = every published path except `index.html`). They are saved in the
   scratchpad; copy each into `data/snapshot/<published path>` (keeping the `past/` folder).
5. **Update and build.** Run `tools/refresh.sh` (allow 10 minutes). It fetches the Premiership season from
   Sportmonks, Aberdeen's cup ties from Wikipedia, updates the date, builds `dist/index-snapshot.html` and runs
   a browser smoke test. If it exits with an error, stop and report the error: do not publish.
6. **Publish the page.** Read the live page first (`action` `read`, `url` = Touchline Lab, `path` = `index.html`),
   copy `dist/index-snapshot.html` to `dist/index-published.html`, then publish that file with `url` = Touchline Lab.
   Leave `capabilities` out, so the page keeps its matchday database.
7. **Save the data back.** Publish to the data store (`url` = data store), with `file_path` = the data store's
   `index.html` from step 4, `root` = `data/snapshot`, and `files` = the files the update changed:
   `manifest.json`, the `sportmonks-501-*.json` file and the `cups-aberdeen-*.json` file named in the manifest's
   `layers`.
8. **Report** in a few lines: the new results (refresh.sh prints them), the new "data to" date, and any warning
   (for example Wikipedia refusing the cup update).

Nothing in this routine is committed to git. Never print, save or commit the token.

## Dry run

When the run's message says "dry run": skip steps 2, 3 and 6, run `tools/refresh.sh --no-fetch` in step 5,
skip step 7, and report whether the restore, build and smoke test worked.

## Limits

- football-data.co.uk is blocked from the cloud, so new league matches come from Sportmonks alone: results,
  line-ups, events, player stats and shots, but no odds, attendance or referee (Ref Watch misses them) until
  the football-data file is refreshed by hand.
- A new season (July) needs its Sportmonks season id and football-data file set up by hand once.
