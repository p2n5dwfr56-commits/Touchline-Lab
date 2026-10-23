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
  cat src/engine.js src/apifootball.js src/footballdata.js src/fbref.js src/sportmonks.js src/ui.js src/tactics.js src/opponents.js src/store.js
  echo '</script>'
} > "$OUT"
echo "built $OUT ($(wc -c < "$OUT") bytes)"
