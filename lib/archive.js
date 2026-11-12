// Το ανοιχτό αρχείο μετρήσεων ζει στον κλάδο `data` του αποθετηρίου (το γεμίζει το GitHub Actions).
// Ο server διαβάζει από εκεί τα τυπικά προφίλ και, στην εκκίνηση, τις μετρήσεις των τελευταίων 24 ωρών.
import { readFile } from 'node:fs/promises';

export const ARCHIVE_BASE = process.env.ARCHIVE_BASE || 'https://raw.githubusercontent.com/LocalAthenianDev/athens-flow/data';

async function get(path) {
  if (!/^https?:/.test(ARCHIVE_BASE)) return readFile(`${ARCHIVE_BASE}/${path}`, 'utf8');
  const res = await fetch(`${ARCHIVE_BASE}/${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.text();
}

export const fetchProfiles = async () => JSON.parse(await get('profiles.json'));
export const fetchStations = async () => JSON.parse(await get('stations.json'));

export async function fetchDay(day) {
  const text = await get(`raw/${day}.csv`);
  const out = [];
  for (const line of text.split('\n').slice(1)) {
    const [ts, id, c, o, s] = line.split(',');
    const t = Date.parse(ts);
    if (!id || !Number.isFinite(t)) continue;
    const n = (x) => (x === '' || x === undefined ? null : Number(x));
    out.push({ id, t, count: n(c), occ: n(o), speed: n(s) });
  }
  return out;
}
