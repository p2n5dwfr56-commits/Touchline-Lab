#!/bin/sh
# Bundles src/ into one self-contained page.
#   ./build.sh                    -> dist/index.html (no bundled data; what the repository ships)
#   ./build.sh --with-snapshot F  -> F, with data/snapshot/ embedded (opens on that real data)
cd "$(dirname "$0")"
OUT=dist/index.html; SNAP=""
if [ "$1" = "--with-snapshot" ]; then OUT=${2:-dist/index-snapshot.html}; SNAP=1; fi
{
  cat src/head.html; echo '<style>'; cat src/style.css; echo '</style>'; echo '<script>'
  if [ -n "$SNAP" ]; then node tools/embed-snapshot.mjs data/snapshot || exit 1; fi
  cat src/engine.js src/apifootball.js src/footballdata.js src/fbref.js src/sportmonks.js src/afcup.js src/wyscout.js src/ui.js src/tactics.js src/pressing.js src/assessment.js src/seasons.js src/opponents.js src/matchday.js src/ask.js src/store.js
  echo '</script>'
} > "$OUT"
node -e "new Function(require('fs').readFileSync(process.argv[1],'utf8').split('<script>')[1].split('</script>')[0])" "$OUT" || { echo "build: script has a syntax error" >&2; exit 1; }
echo "built $OUT ($(wc -c < "$OUT") bytes)"
