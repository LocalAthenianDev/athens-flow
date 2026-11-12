// Τρέχει από το GitHub Actions κάθε λίγα λεπτά: παίρνει το τρέχον στιγμιότυπο του API,
// γράφει τις νέες μετρήσεις στο ημερήσιο CSV και ενημερώνει τα τυπικά προφίλ.
// Χρήση: node scripts/archive.mjs <φάκελος δεδομένων>
import { readFile, writeFile, appendFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fetchSnapshot } from '../lib/clean.js';
import { emptyProfiles, addReading } from '../lib/profiles.js';

const dir = process.argv[2] || 'archive';
const readJson = async (f, fb) => (existsSync(f) ? JSON.parse(await readFile(f, 'utf8')) : fb);

const { rows } = await fetchSnapshot();
await mkdir(join(dir, 'raw'), { recursive: true });
const last = await readJson(join(dir, 'last.json'), {});
const profiles = await readJson(join(dir, 'profiles.json'), emptyProfiles());

const stations = {};
const byDay = new Map();
let fresh = 0;
for (const { station, reading: r } of rows) {
  stations[station.id] = station;
  if (last[r.id] && last[r.id] >= r.t) continue; // ίδια μέτρηση με την προηγούμενη φορά
  last[r.id] = r.t;
  if (r.count === null && r.speed === null && r.occ === null) continue;
  const day = new Date(r.t).toISOString().slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, []);
  byDay.get(day).push(`${new Date(r.t).toISOString().slice(0, 19)}Z,${r.id},${r.count ?? ''},${r.occ ?? ''},${r.speed ?? ''}`);
  addReading(profiles, r);
  fresh++;
}
for (const [day, lines] of byDay) {
  const f = join(dir, 'raw', `${day}.csv`);
  if (!existsSync(f)) await writeFile(f, 'timestamp_utc,station_id,flow_veh_per_hour,occupancy_pct,speed_kmh\n');
  await appendFile(f, lines.join('\n') + '\n');
}
await writeFile(join(dir, 'last.json'), JSON.stringify(last));
await writeFile(join(dir, 'profiles.json'), JSON.stringify(profiles));
await writeFile(join(dir, 'stations.json'), JSON.stringify(Object.values(stations).sort((a, b) => a.id.localeCompare(b.id)), null, 1));
console.log(`${rows.length} σταθμοί, ${fresh} νέες μετρήσεις, ${profiles.samples} δείγματα συνολικά`);
