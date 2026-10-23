// Prints `const SNAPSHOT = {...};` for build.sh: a bundled data snapshot the app loads when the viewer has no saved imports.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = process.argv[2];
const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const file = (name) => ({ name, text: readFileSync(join(dir, name), 'utf8') });
const snap = { asOf: m.asOf, primary: m.primary.map(file), fbref: (m.fbref || []).map((f) => ({ team: f.team, texts: f.files.map(file) })), layers: (m.layers || []).map(file) };
// Escape "<" so file contents can never close the surrounding <script>
process.stdout.write('const SNAPSHOT = ' + JSON.stringify(snap).replace(/</g, '\\u003c') + ';\n');
// Optional StatsBomb sample (a file from tools/fetch-statsbomb.mjs), for the event-data views
if (m.sample) {
  const b = JSON.parse(readFileSync(join(dir, m.sample), 'utf8'));
  process.stdout.write('const SAMPLE_EVENTS = ' + JSON.stringify({ label: b.label, attribution: b.attribution, db: b.db }).replace(/</g, '\\u003c') + ';\n');
}
