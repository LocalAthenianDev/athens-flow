// Κατάσταση στη μνήμη: σταθμοί, τελευταία μέτρηση, σειρά 24 ωρών, τυπικά προφίλ.
// Από εδώ βγαίνουν όλα όσα δείχνει η εφαρμογή: σταθμοί, άξονες, κοινότητες, σύνοψη.
import { readFile } from 'node:fs/promises';
import { classify } from './classify.js';
import { communityOf, km, CENTRE } from './geo.js';
import { freeFlow, SLOTS } from './profiles.js';
import { slot } from './time.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const STALE_MIN = Number(process.env.STALE_MIN || 15);   // χωρίς νέα μέτρηση τόσα λεπτά = εκτός λειτουργίας
const TREND_HOURS = 24;
const BUCKET = 10 * MIN;                                 // ανάλυση της σειράς 24 ωρών

const koinotites = JSON.parse(await readFile(new URL('../public/data/koinotites.json', import.meta.url), 'utf8'));

export const LEVELS = [null, 'Ελεύθερη', 'Πυκνή', 'Αργή', 'Μποτιλιάρισμα'];
export const DIRS = { in: 'Προς Αθήνα', out: 'Από Αθήνα', cross: 'Εγκάρσια' };

export const state = {
  stations: new Map(),  // id -> στοιχεία σταθμού (με κατεύθυνση και κοινότητα)
  latest: new Map(),    // id -> τελευταία μέτρηση
  trend: new Map(),     // id -> Map(bucket -> { n, s, o, c })
  profiles: null,       // από το αρχείο (κλάδος data)
  ff: new Map(),        // id -> ταχύτητα ελεύθερης ροής
  newest: 0,
};

// ---------- βοηθητικά ----------
const r0 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x));
const r2 = (x) => (x === null || x === undefined || Number.isNaN(x) ? null : Math.round(x * 100) / 100);
function median(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Βαθμίδα κίνησης 1–4. Με γνωστή ταχύτητα ελεύθερης ροής συγκρίνουμε τον σταθμό με τον εαυτό του.
// Χωρίς αυτήν (νέος σταθμός, λίγο ιστορικό) χρησιμοποιούμε την κατάληψη του δρόμου.
export function levelOf(speed, occ, ff) {
  if (speed === null || speed === undefined) return null;
  if (ff) return levelOfRatio(speed / ff);
  if (occ === null || occ === undefined) return null;
  return occ < 15 ? 1 : occ < 25 ? 2 : occ < 40 ? 3 : 4;
}
export const levelOfRatio = (r) => (r === null ? null : r >= 0.7 ? 1 : r >= 0.5 ? 2 : r >= 0.3 ? 3 : 4);

// ---------- εισαγωγή ----------
export function ingest(rows) {
  let fresh = 0;
  for (const { station, reading } of rows) {
    if (station.lat !== null || !state.stations.has(station.id)) {
      const c = classify(station);
      const community = station.lat !== null ? communityOf([station.lon, station.lat], koinotites) : null;
      state.stations.set(station.id, {
        ...station, dir: c.dir, dirHow: c.how, arrow: c.arrow, community,
        km: station.lat !== null ? Math.round(km([station.lon, station.lat], CENTRE) * 10) / 10 : null,
      });
    }
    fresh += addReading(reading) ? 1 : 0;
  }
  prune();
  return fresh;
}

export function addReading(r) {
  const prev = state.latest.get(r.id);
  if (prev && prev.t >= r.t) return false;
  state.latest.set(r.id, r);
  if (r.t > state.newest && r.t < Date.now() + 10 * MIN) state.newest = r.t;
  if (r.speed === null && r.count === null) return true;
  let m = state.trend.get(r.id);
  if (!m) state.trend.set(r.id, (m = new Map()));
  const b = Math.floor(r.t / BUCKET) * BUCKET;
  let o = m.get(b);
  if (!o) m.set(b, (o = { n: 0, s: 0, ns: 0, o: 0, c: 0 }));
  o.n++; o.c += r.count ?? 0; o.o += r.occ ?? 0;
  if (r.speed !== null) { o.s += r.speed; o.ns++; }
  return true;
}

function prune() {
  const cutoff = (state.newest || Date.now()) - TREND_HOURS * HOUR;
  for (const m of state.trend.values()) for (const b of m.keys()) if (b < cutoff) m.delete(b);
}

export function setProfiles(p) {
  state.profiles = p;
  state.ff = new Map();
  for (const [id, e] of Object.entries(p.st || {})) {
    const f = freeFlow(e);
    if (f) state.ff.set(id, f);
  }
}

// ---------- προφίλ 7 × 24 ----------
// Για ένα σύνολο σταθμών: σε κάθε ώρα της εβδομάδας, μέση ταχύτητα και μέσος λόγος προς την ελεύθερη ροή.
function profileOf(ids) {
  const out = Array.from({ length: SLOTS }, () => ({ speed: [], ratio: [], n: 0 }));
  const st = state.profiles?.st || {};
  for (const id of ids) {
    const e = st[id];
    if (!e) continue;
    const ff = state.ff.get(id);
    for (let i = 0; i < SLOTS; i++) {
      if (e.n[i] < 2) continue;
      const v = e.s[i] / e.n[i];
      out[i].speed.push(v);
      if (ff) out[i].ratio.push(Math.min(1.2, v / ff));
      out[i].n += e.n[i];
    }
  }
  return out.map((o) => {
    const ratio = o.ratio.length ? mean(o.ratio) : null;
    return { speed: r0(mean(o.speed)), ratio: r2(ratio), level: levelOfRatio(ratio), n: o.n };
  });
}

function trendOf(ids) {
  const acc = new Map();
  for (const id of ids) {
    const m = state.trend.get(id);
    if (!m) continue;
    const ff = state.ff.get(id);
    for (const [b, o] of m) {
      if (!o.ns) continue;
      let a = acc.get(b);
      if (!a) acc.set(b, (a = { speed: [], flow: [], ratio: [] }));
      const v = o.s / o.ns;
      a.speed.push(v); a.flow.push(o.c / o.n);
      if (ff) a.ratio.push(v / ff);
    }
  }
  return [...acc.entries()].sort(([a], [b]) => a - b).map(([t, a]) => ({
    t: new Date(t).toISOString(), speed: r0(median(a.speed)), flow: r0(median(a.flow)), level: levelOfRatio(a.ratio.length ? mean(a.ratio) : null),
  }));
}

// Σύνοψη ενός συνόλου σταθμών για «τώρα»
function summarize(list) {
  const on = list.filter((s) => s.online && s.speed !== null);
  const lv = on.map((s) => s.level).filter(Boolean);
  const ratios = on.map((s) => s.ratio).filter((x) => x !== null);
  const ratio = ratios.length ? mean(ratios) : null;
  const typ = on.filter((s) => s.typical !== null);
  return {
    stations: list.length, online: on.length,
    speed: r0(median(on.map((s) => s.speed))),
    flow: r0(median(on.map((s) => s.flow).filter((x) => x !== null))),
    occ: r0(median(on.map((s) => s.occ).filter((x) => x !== null))),
    level: ratio !== null ? levelOfRatio(ratio) : (lv.length ? Math.round(mean(lv)) : null),
    slowShare: lv.length ? Math.round((100 * lv.filter((x) => x >= 3).length) / lv.length) : null,
    // Πόσο πιο γρήγορα ή αργά από το συνηθισμένο για αυτή την ημέρα και ώρα (%)
    vsTypical: typ.length >= Math.max(2, on.length / 2) ? Math.round(100 * (mean(typ.map((s) => s.speed / s.typical)) - 1)) : null,
  };
}

const LAT = { α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps', ω: 'o' };
const roadKey = (road) => road.toLowerCase().replace(/[α-ω]/g, (c) => LAT[c] || c).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- πλήρης υπολογισμός ----------
export function compute(now = Date.now()) {
  prune();
  const ref = Math.max(state.newest, now - 5 * MIN);
  const nowSlot = slot(ref);
  const pst = state.profiles?.st || {};

  const stations = [];
  for (const s of state.stations.values()) {
    const r = state.latest.get(s.id);
    const online = Boolean(r) && ref - r.t <= STALE_MIN * MIN && s.kind !== 'bus';
    const ff = state.ff.get(s.id) ?? null;
    const speed = online ? r.speed : null;
    const e = pst[s.id];
    const typical = e && e.n[nowSlot] >= 3 ? e.s[nowSlot] / e.n[nowSlot] : null;
    stations.push({
      id: s.id, road: s.road, roadLabel: s.roadLabel, dimos: s.dimos, desc: s.desc, kind: s.kind,
      dir: s.dir, arrow: s.arrow, lanes: s.lanes, lat: s.lat, lon: s.lon, community: s.community, km: s.km,
      online, t: r ? new Date(r.t).toISOString() : null,
      speed, flow: online ? r.count : null, occ: online ? r.occ : null,
      ff: r0(ff), ratio: speed !== null && ff ? r2(Math.min(1.2, speed / ff)) : null,
      level: online ? levelOf(speed, r.occ, ff) : null,
      typical: r0(typical),
    });
  }

  // Στις συνόψεις μετράνε μόνο οι σταθμοί κύριου δρόμου: ράμπες και λωρίδες στροφής έχουν άλλη συμπεριφορά.
  const main = stations.filter((s) => s.kind === 'main' && s.lat !== null);

  // Άξονες: οδός με τουλάχιστον 3 σταθμούς κύριου δρόμου
  const byRoad = new Map();
  for (const s of main) {
    if (!s.road) continue;
    if (!byRoad.has(s.road)) byRoad.set(s.road, []);
    byRoad.get(s.road).push(s);
  }
  const corridors = [];
  const corridorDetail = {};
  for (const [road, list] of byRoad) {
    if (list.length < 3) continue;
    const key = roadKey(road);
    const dirs = {};
    const detailDirs = {};
    for (const d of ['in', 'out', 'cross']) {
      const m = list.filter((s) => s.dir === d);
      if (!m.length) continue;
      dirs[d] = summarize(m);
      const ids = m.map((s) => s.id);
      detailDirs[d] = {
        ...dirs[d],
        // από την περιφέρεια προς το κέντρο για «προς», αντίστροφα για «από»
        stationIds: [...m].sort((a, b) => (d === 'out' ? a.km - b.km : b.km - a.km)).map((s) => s.id),
        trend: trendOf(ids),
        profile: profileOf(ids),
      };
    }
    const all = summarize(list);
    const lats = list.map((s) => s.lat), lons = list.map((s) => s.lon);
    const c = {
      key, road, label: list.some((s) => /^Λ\./.test(s.roadLabel || '')) ? `Λ. ${road}` : road,
      stations: list.length, online: all.online, level: all.level, speed: all.speed, slowShare: all.slowShare,
      inAthens: list.filter((s) => s.community).length,
      bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
      dirs,
    };
    corridors.push(c);
    corridorDetail[key] = { ...c, dirs: detailDirs };
  }
  corridors.sort((a, b) => b.stations - a.stations);

  // Δημοτικές κοινότητες του Δήμου Αθηναίων
  const communities = koinotites.map((k) => {
    const m = main.filter((s) => s.community === k.id);
    return { id: k.id, name: k.n, ...summarize(m), in: summarize(m.filter((s) => s.dir === 'in')), out: summarize(m.filter((s) => s.dir === 'out')) };
  });

  const athens = main.filter((s) => s.community);
  const outside = main.filter((s) => !s.community);
  const flowSum = (d) => corridors.reduce((a, c) => a + (c.dirs[d]?.flow ?? 0), 0);
  const summary = {
    all: summarize(main),
    in: { ...summarize(main.filter((s) => s.dir === 'in')), corridorFlow: flowSum('in') },
    out: { ...summarize(main.filter((s) => s.dir === 'out')), corridorFlow: flowSum('out') },
    cross: summarize(main.filter((s) => s.dir === 'cross')),
    athens: summarize(athens),
    approach: summarize(outside.filter((s) => s.dir === 'in')),   // εκτός Δήμου, με κατεύθυνση προς αυτόν
    leaving: summarize(outside.filter((s) => s.dir === 'out')),
    trend: { in: trendOf(main.filter((s) => s.dir === 'in').map((s) => s.id)), out: trendOf(main.filter((s) => s.dir === 'out').map((s) => s.id)) },
  };

  const p = state.profiles;
  const meta = {
    latest: state.newest ? new Date(state.newest).toISOString() : null,
    stations: stations.length,
    online: stations.filter((s) => s.online).length,
    located: stations.filter((s) => s.lat !== null).length,
    withFreeFlow: state.ff.size,
    history: p ? { since: p.since, updated: p.updated, samples: p.samples, hours: p.since ? Math.round((Date.parse(p.updated) - Date.parse(p.since)) / HOUR) : 0 } : null,
    slot: nowSlot,
    levels: LEVELS, dirs: DIRS,
  };

  const stationDetail = (id) => {
    const s = stations.find((x) => x.id === id);
    if (!s) return null;
    return { ...s, trend: trendOf([id]), profile: profileOf([id]) };
  };
  return { meta, summary, corridors, communities, stations, corridorDetail, stationDetail };
}
