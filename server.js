import express from 'express';
import compression from 'compression';
import { fetchSnapshot } from './lib/clean.js';
import { state, ingest, addReading, setProfiles, compute } from './lib/store.js';
import { fetchProfiles, fetchStations, fetchDay } from './lib/archive.js';
import { createArchiver } from './lib/archiver.js';

const PORT = process.env.PORT || 3000;
const REFRESH_SEC = Number(process.env.REFRESH_SEC || 60);
const PROFILES_MIN = Number(process.env.PROFILES_MIN || 15);
const MOCK = process.env.MOCK === '1'; // χωρίς πρόσβαση στο API: δουλεύει μόνο με το αρχείο
const APP_ENV = process.env.APP_ENV || 'production';
const ARCHIVE_PUSH_MIN = Number(process.env.ARCHIVE_PUSH_MIN || 10);

// Με GITHUB_TOKEN ο server γράφει ο ίδιος το ιστορικό στον κλάδο `data`. Το token μένει μόνο στο περιβάλλον.
const archiver = process.env.GITHUB_TOKEN && !MOCK
  ? createArchiver({
    token: process.env.GITHUB_TOKEN,
    repo: process.env.ARCHIVE_REPO || 'LocalAthenianDev/athens-flow',
    branch: process.env.ARCHIVE_BRANCH || 'data',
    api: process.env.GITHUB_API || undefined,
  })
  : null;

const cache = { data: null, at: 0, etag: null, loading: null, lastError: null, profilesAt: 0 };

async function loadProfiles() {
  try {
    setProfiles(await fetchProfiles());
    cache.profilesAt = Date.now();
  } catch (e) { console.warn('[προφίλ]', e.message); }
}

// Στην εκκίνηση: οι μετρήσεις των τελευταίων 24 ωρών από το αρχείο, για να μην ξεκινά άδεια η σειρά.
async function seed() {
  const day = (t) => new Date(t).toISOString().slice(0, 10);
  const days = [...new Set([day(Date.now() - 86_400_000), day(Date.now())])];
  if (MOCK) {
    try {
      const stations = await fetchStations();
      ingest(stations.map((station) => ({ station, reading: { id: station.id, t: 0, count: null, occ: null, speed: null } })));
    } catch (e) { console.warn('[σταθμοί]', e.message); }
  }
  for (const d of days) {
    try {
      const rows = await fetchDay(d);
      rows.sort((a, b) => a.t - b.t).forEach(addReading);
      console.log(`[αρχείο] ${d}: ${rows.length} μετρήσεις`);
    } catch (e) { console.warn('[αρχείο]', d, e.message); }
  }
}

async function load() {
  if (!MOCK) {
    const snap = await fetchSnapshot(cache.etag);
    if (!snap.unchanged) { cache.etag = snap.etag; ingest(snap.rows); archiver?.collect(snap.rows); }
  }
  if (Date.now() - cache.profilesAt > PROFILES_MIN * 60_000) await loadProfiles();
  cache.data = compute(MOCK ? state.newest : Date.now());
  cache.at = Date.now();
  cache.lastError = null;
}

function refresh() {
  if (cache.loading) return cache.loading;
  cache.loading = load()
    .catch((e) => { cache.lastError = e.message; console.error('[φόρτωση] αποτυχία:', e.message); if (!cache.data) throw e; })
    .finally(() => { cache.loading = null; });
  return cache.loading;
}

async function getData() {
  if (!cache.data) await refresh();
  else if (Date.now() - cache.at > REFRESH_SEC * 1000) refresh(); // αν ο server είχε κοιμηθεί
  return cache.data;
}

const app = express();
app.disable('x-powered-by');
app.use(compression());
if (APP_ENV !== 'production') app.use((req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use(express.static('public', { maxAge: '5m' }));
// Ανοιχτές βιβλιοθήκες και γραμματοσειρά από τον δικό μας server, χωρίς CDN τρίτων
const vendor = (p) => express.static(new URL(`./node_modules/${p}`, import.meta.url).pathname, { maxAge: '7d' });
app.use('/vendor/leaflet', vendor('leaflet/dist'));
app.use('/vendor/commissioner', vendor('@fontsource/commissioner'));

const send = (res, fn) => getData()
  .then((d) => { res.set('Cache-Control', 'public, max-age=30'); fn(d); })
  .catch((e) => res.status(503).json({ error: 'Τα ανοιχτά δεδομένα δεν είναι διαθέσιμα αυτή τη στιγμή', detail: e.message }));

app.get('/api/live', (req, res) => send(res, (d) => res.json({
  meta: { ...d.meta, env: APP_ENV, mock: MOCK, updated: new Date(cache.at).toISOString(), lastError: cache.lastError },
  summary: d.summary, corridors: d.corridors, communities: d.communities, gates: d.gates, stations: d.stations,
})));
app.get('/api/corridors/:key', (req, res) => send(res, (d) => {
  const c = d.corridorDetail[req.params.key];
  return c ? res.json(c) : res.status(404).json({ error: 'Άγνωστος άξονας' });
}));
app.get('/api/stations/:id', (req, res) => send(res, (d) => {
  const s = d.stationDetail(req.params.id);
  return s ? res.json(s) : res.status(404).json({ error: 'Άγνωστος σταθμός' });
}));
app.get('/healthz', (req, res) => res.json({
  ok: true, cached: Boolean(cache.data), latest: cache.data?.meta.latest ?? null,
  archive: archiver ? archiver.status() : { enabled: false },
}));

app.listen(PORT, async () => {
  console.log(`Athens Flow στο http://localhost:${PORT}${MOCK ? ' (MOCK)' : ''}`);
  await loadProfiles();
  await seed();
  refresh().catch(() => {});
  setInterval(() => refresh().catch(() => {}), REFRESH_SEC * 1000).unref();
  if (archiver) {
    console.log(`[αρχείο] αποθήκευση στον κλάδο data κάθε ${ARCHIVE_PUSH_MIN} λεπτά`);
    setInterval(() => archiver.flush(), ARCHIVE_PUSH_MIN * 60_000).unref();
  }
});

// Σε επανεκκίνηση (π.χ. νέο deploy) γράφουμε πρώτα ό,τι περιμένει στη μνήμη
if (archiver) {
  process.once('SIGTERM', async () => {
    await Promise.race([archiver.flush(true), new Promise((r) => setTimeout(r, 8000))]);
    process.exit(0);
  });
}
