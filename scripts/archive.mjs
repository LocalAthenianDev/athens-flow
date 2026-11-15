// Εφεδρική συλλογή από το GitHub Actions (την κύρια την κάνει ο server, lib/archiver.js):
// παίρνει το τρέχον στιγμιότυπο του API, γράφει τις νέες μετρήσεις στο CSV της ώρας
// και ενημερώνει τα τυπικά προφίλ.
// Χρήση: node scripts/archive.mjs <φάκελος δεδομένων>
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fetchSnapshot } from '../lib/clean.js';
import { emptyProfiles, addReading } from '../lib/profiles.js';
import { CSV_HEADER, rawPath, csvLine, worthKeeping, stationsJson } from '../lib/archiver.js';

const dir = process.argv[2] || 'archive';
const readJson = async (f, fb) => (existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fb);

const { rows } = await fetchSnapshot();
await mkdir(join(dir, 'raw'), { recursive: true });
const last = await readJson(join(dir, 'last.json'), {});
const profiles = await readJson(join(dir, 'profiles.json'), emptyProfiles());

const stations = {};
const byFile = new Map();
let fresh = 0;
for (const { station, reading: r } of rows) {
  stations[station.id] = station;
  if (last[r.id] && last[r.id] >= r.t) continue; // ίδια μέτρηση με την προηγούμενη φορά
  last[r.id] = r.t;
  if (!worthKeeping(r, Date.now())) continue;
  const f = join(dir, rawPath(r.t));
  if (!byFile.has(f)) byFile.set(f, []);
  byFile.get(f).push(csvLine(r));
  addReading(profiles, r);
  fresh++;
}
for (const [f, lines] of byFile) {
  await mkdir(dirname(f), { recursive: true });
  if (!existsSync(f)) await writeFile(f, CSV_HEADER);
  await appendFile(f, lines.join('\n') + '\n');
}
await writeFile(join(dir, 'last.json'), JSON.stringify(last));
await writeFile(join(dir, 'profiles.json'), JSON.stringify(profiles));
// Σταθμοί που λείπουν τώρα από το API μένουν στον κατάλογο
for (const s of await readJson(join(dir, 'stations.json'), [])) stations[s.id] ??= s;
await writeFile(join(dir, 'stations.json'), stationsJson(stations));
console.log(`${rows.length} σταθμοί, ${fresh} νέες μετρήσεις, ${profiles.samples} δείγματα συνολικά`);
