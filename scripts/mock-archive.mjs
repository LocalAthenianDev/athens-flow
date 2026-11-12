// Μόνο για ανάπτυξη χωρίς πρόσβαση στο API: φτιάχνει συνθετικό αρχείο 9 ημερών
// με πρωινή και απογευματινή αιχμή, πάνω στους πραγματικούς σταθμούς (stations.json).
// Χρήση: node scripts/mock-archive.mjs <φάκελος με stations.json> <φάκελος εξόδου>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { emptyProfiles, addReading } from '../lib/profiles.js';
import { classify } from '../lib/classify.js';
import { athens } from '../lib/time.js';

const [src = 'archive', out = 'archive-mock'] = process.argv.slice(2);
const stations = JSON.parse(await readFile(join(src, 'stations.json'), 'utf8'));
await mkdir(join(out, 'raw'), { recursive: true });
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const bump = (h, c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
const profiles = emptyProfiles();
const days = new Map();
const end = Math.floor(Date.now() / 600000) * 600000;
const model = stations.filter((s) => s.lat !== null).map((s) => ({
  s, dir: classify(s).dir, ff: s.kind === 'main' ? 35 + rnd() * 45 : 25 + rnd() * 20, cap: 600 + rnd() * 700 * (s.lanes || 2), sens: 0.4 + rnd() * 0.8,
}));
for (let t = end - 9 * 86400000; t <= end; t += 600000) {
  const a = athens(t);
  const h = a.hour + a.minute / 60;
  const wk = a.dow >= 5 ? 0.45 : 1;
  for (const m of model) {
    if (rnd() < 0.04) continue;
    const am = bump(h, 8.3, 1.2) * (m.dir === 'in' ? 1 : 0.45);
    const pm = bump(h, 17.3, 1.8) * (m.dir === 'out' ? 1 : 0.6);
    const load = Math.min(1, (0.12 + 0.5 * bump(h, 13, 5) + 0.75 * wk * (am + pm)) * m.sens + (rnd() - 0.5) * 0.12);
    const speed = Math.max(4, Math.round(m.ff * (1 - 0.8 * Math.max(0, load - 0.35) / 0.65) + (rnd() - 0.5) * 6));
    const count = Math.max(0, Math.round((m.cap * Math.min(1, load * 1.3) * (load > 0.85 ? 0.7 : 1)) / 20) * 20);
    const occ = Math.min(90, Math.round(4 + load * 55 + (rnd() - 0.5) * 6));
    const r = { id: m.s.id, t, count, occ, speed };
    addReading(profiles, r);
    const day = new Date(t).toISOString().slice(0, 10);
    if (!days.has(day)) days.set(day, ['timestamp_utc,station_id,flow_veh_per_hour,occupancy_pct,speed_kmh']);
    if (t > end - 2 * 86400000) days.get(day).push(`${new Date(t).toISOString().slice(0, 19)}Z,${r.id},${count},${occ},${speed}`);
  }
}
for (const [day, lines] of days) await writeFile(join(out, 'raw', `${day}.csv`), lines.join('\n') + '\n');
await writeFile(join(out, 'profiles.json'), JSON.stringify(profiles));
await writeFile(join(out, 'stations.json'), JSON.stringify(stations));
console.log(`Συνθετικό αρχείο στο ${out}: ${profiles.samples} δείγματα`);
