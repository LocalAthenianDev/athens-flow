// Συλλογή του ανοιχτού ιστορικού από τον ίδιο τον server.
// Ο server ρωτάει ήδη το API κάθε λεπτό. Εδώ κρατάμε κάθε νέα μέτρηση στη μνήμη και,
// κάθε λίγα λεπτά, τη γράφουμε με ένα commit στον κλάδο `data` μέσω του GitHub API.
// Χρειάζεται GITHUB_TOKEN με δικαίωμα εγγραφής στα περιεχόμενα του αποθετηρίου.
// Χωρίς token δεν κάνει τίποτα και το αρχείο το γεμίζει μόνο το GitHub Actions.
import { addReading } from './profiles.js';

export const CSV_HEADER = 'timestamp_utc,station_id,flow_veh_per_hour,occupancy_pct,speed_kmh\n';
export const STALE_MS = 30 * 60_000; // κολλημένος σταθμός, παλιά μέτρηση
const MAX_PENDING = 300_000;
const BOT = { name: 'athens-flow-bot', email: 'athens-flow-bot@users.noreply.github.com' };

const iso = (t) => new Date(t).toISOString();
// Ένα αρχείο ανά ώρα (UTC), για να μη ξαναγράφεται ολόκληρη η ημέρα σε κάθε αποθήκευση
export const rawPath = (t) => `raw/${iso(t).slice(0, 10)}/${iso(t).slice(11, 13)}.csv`;
export const csvLine = (r) => `${iso(r.t).slice(0, 19)}Z,${r.id},${r.count ?? ''},${r.occ ?? ''},${r.speed ?? ''}`;
export const worthKeeping = (r, now) => !(r.count === null && r.speed === null && r.occ === null) && now - r.t <= STALE_MS;
export const stationsJson = (stations) => JSON.stringify(Object.values(stations).sort((a, b) => a.id.localeCompare(b.id)), null, 1);

export function createArchiver({ token, repo, branch = 'data', api = 'https://api.github.com' }) {
  const base = `${api}/repos/${repo}`;
  const seen = new Map(); // τελευταία μέτρηση που είδαμε ανά σταθμό
  const stations = {};
  let pending = []; // μετρήσεις που δεν έχουν γραφτεί ακόμη στον κλάδο
  let forProfiles = []; // γραμμένες στα CSV, όχι ακόμη στο profiles.json
  let profilesHour = null;
  let stationsOnBranch = null;
  let busy = null;
  const status = { enabled: true, lastPush: null, lastError: null, commits: 0, readings: 0 };

  async function gh(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'athens-flow',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path.split('?')[0]}: ${res.status}`);
    return raw ? res.text() : res.json();
  }
  const file = (path, ref) => gh(`/contents/${path}?ref=${ref}`, { raw: true });

  function collect(rows, now = Date.now()) {
    for (const { station, reading: r } of rows) {
      stations[station.id] = station;
      if ((seen.get(r.id) ?? 0) >= r.t) continue;
      seen.set(r.id, r.t);
      if (worthKeeping(r, now)) pending.push(r);
    }
    if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
  }

  async function push(final) {
    const now = Date.now();
    const head = (await gh(`/git/ref/heads/${branch}`))?.object.sha;
    if (!head) throw new Error(`δεν βρέθηκε ο κλάδος ${branch}`);
    const parent = await gh(`/git/commits/${head}`);

    // Ό,τι έχει ήδη γράψει κάποιος άλλος (π.χ. το GitHub Actions) δεν ξαναγράφεται
    const last = JSON.parse((await file('last.json', head)) ?? '{}');
    const taken = pending.length;
    const fresh = [];
    for (const r of pending.slice(0, taken).sort((a, b) => a.t - b.t)) {
      if (last[r.id] && last[r.id] >= r.t) continue;
      last[r.id] = r.t;
      fresh.push(r);
    }

    const tree = [];
    const add = (path, content) => tree.push({ path, mode: '100644', type: 'blob', content });

    const byFile = new Map();
    for (const r of fresh) {
      const p = rawPath(r.t);
      if (!byFile.has(p)) byFile.set(p, []);
      byFile.get(p).push(csvLine(r));
    }
    for (const [path, lines] of byFile) {
      let text = (await file(path, head)) ?? CSV_HEADER;
      if (!text.endsWith('\n')) text += '\n';
      add(path, text + lines.join('\n') + '\n');
    }
    if (fresh.length) add('last.json', JSON.stringify(last));

    // Τα προφίλ αλλάζουν λίγο σε κάθε μέτρηση, οπότε γράφονται μία φορά την ώρα
    const hour = iso(now).slice(0, 13);
    const toProfile = forProfiles.concat(fresh);
    const writeProfiles = toProfile.length > 0 && (final || profilesHour !== hour);
    if (writeProfiles) {
      const text = await file('profiles.json', head);
      if (!text) throw new Error('δεν βρέθηκε το profiles.json');
      const profiles = JSON.parse(text);
      toProfile.forEach((r) => addReading(profiles, r));
      add('profiles.json', JSON.stringify(profiles));
    }

    if (stationsOnBranch === null) {
      stationsOnBranch = (await file('stations.json', head)) ?? '';
      // Σταθμοί που υπάρχουν στο αρχείο αλλά λείπουν τώρα από το API μένουν στον κατάλογο
      for (const s of stationsOnBranch ? JSON.parse(stationsOnBranch) : []) stations[s.id] ??= s;
    }
    const stationsNow = stationsJson(stations);
    const writeStations = Object.keys(stations).length > 0 && stationsNow !== stationsOnBranch;
    if (writeStations) add('stations.json', stationsNow);

    if (tree.length) {
      const t = await gh('/git/trees', { method: 'POST', body: { base_tree: parent.tree.sha, tree } });
      const c = await gh('/git/commits', {
        method: 'POST',
        body: { message: `Μετρήσεις ${iso(now).slice(0, 16)}Z`, tree: t.sha, parents: [head], author: BOT, committer: BOT },
      });
      // Χωρίς force: αν στο μεταξύ έγραψε κάποιος άλλος, αποτυγχάνει και ξαναδοκιμάζουμε στον επόμενο κύκλο
      await gh(`/git/refs/heads/${branch}`, { method: 'PATCH', body: { sha: c.sha, force: false } });
      status.commits++;
    }
    pending = pending.slice(taken);
    forProfiles = writeProfiles ? [] : toProfile;
    if (writeProfiles) profilesHour = hour;
    if (writeStations) stationsOnBranch = stationsNow;
    status.readings += fresh.length;
    status.lastPush = iso(now);
    status.lastError = null;
    return fresh.length;
  }

  function flush(final = false) {
    if (busy) return busy;
    busy = push(final)
      .then((n) => { if (n) console.log(`[αρχείο] γράφτηκαν ${n} μετρήσεις στον κλάδο ${branch}`); })
      .catch((e) => { status.lastError = e.message; console.error('[αρχείο] αποτυχία αποθήκευσης:', e.message); })
      .finally(() => { busy = null; });
    return busy;
  }

  return { collect, flush, status: () => ({ ...status, pending: pending.length }) };
}
