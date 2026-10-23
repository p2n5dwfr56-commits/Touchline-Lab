#!/bin/sh
# Bundles src/ into one self-contained page: dist/index.html
cd "$(dirname "$0")"
{ cat src/head.html; echo '<style>'; cat src/style.css; echo '</style>'; echo '<script>'; cat src/engine.js; cat src/apifootball.js; cat src/footballdata.js; cat src/ui.js; cat src/tactics.js; echo '</script>'; } > dist/index.html
echo "built dist/index.html ($(wc -c < dist/index.html) bytes)"
