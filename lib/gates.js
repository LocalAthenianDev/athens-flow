// Πύλες του Δήμου Αθηναίων: πόσα οχήματα μπαίνουν και βγαίνουν από τις κύριες εισόδους.
// Κάθε πύλη είναι ένας δρόμος που περνά το όριο του Δήμου, με έναν σταθμό μέτρησης ανά κατεύθυνση
// κοντά στο όριο (public/data/pyles.json). Η ροή κάθε σταθμού είναι σε οχήματα ανά ώρα, οπότε
// ο όγκος ενός δεκάλεπτου είναι η μέση ροή του επί 1/6 της ώρας.
// Όπου λείπει μέτρηση (σταθμός εκτός λειτουργίας, κενό στη συλλογή) μπαίνει η συνηθισμένη τιμή
// της ίδιας ώρας, ώστε ένα κενό να μη φαίνεται σαν πτώση της κίνησης. Οι συγκρίσεις με το
// συνηθισμένο γίνονται μόνο πάνω σε πραγματικές μετρήσεις.
import { athens } from './time.js';

const MIN = 60_000;
const HOUR = 60 * MIN;
const BUCKET = 10 * MIN;
const PER_BUCKET = BUCKET / HOUR;
const MIN_MEASURED = 0.6; // μια ώρα δείχνεται αν τη μέτρησε τουλάχιστον το 60% των πυλών

// Συνηθισμένη ροή (οχ./ώρα) ενός σταθμού σε μία ώρα της εβδομάδας, από τα προφίλ του αρχείου.
// Τα προφίλ περιέχουν ήδη και τις σημερινές μετρήσεις, οπότε τις αφαιρούμε (skip), για να
// συγκρίνεται η σημερινή ημέρα με τις προηγούμενες εβδομάδες και όχι με τον εαυτό της.
function typicalFlow(profiles, id, slot, skip) {
  const e = profiles?.st?.[id];
  if (!e) return null;
  const n = e.n[slot] - (skip?.n || 0);
  return n >= 3 ? (e.c[slot] - (skip?.c || 0)) / n : null;
}

const pct = (a, b) => (a !== null && b ? Math.round(100 * (a / b - 1)) : null);
const round = (x, step) => (x === null || x === undefined ? null : Math.round(x / step) * step);

/**
 * @param list     οι πύλες από το pyles.json
 * @param byId     Map id -> σταθμός όπως τον βγάζει το compute() (online, flow)
 * @param trend    Map id -> Map(δεκάλεπτο -> { n, c, ... }) των τελευταίων 24 ωρών
 * @param profiles τα προφίλ 7 × 24 του αρχείου
 * @param ref      η τρέχουσα στιγμή
 */
export function computeGates({ list, byId, trend, profiles, ref }) {
  const a = athens(ref);
  const midnight = ref - (a.hour * 60 + a.minute) * MIN - (ref % MIN);
  const day = a.dow;
  const lastBucket = Math.floor(ref / BUCKET) * BUCKET; // το τρέχον, μισό δεκάλεπτο δεν μετράει
  // Ως πού φτάνουν τα προφίλ: οι σημερινές μετρήσεις μέχρι εκεί έχουν ήδη μπει μέσα τους
  const upto = profiles?.updated ? Date.parse(profiles.updated) : 0;
  const inProfile = new Map(); // id -> [24] { c, n }
  const skipOf = (id) => {
    if (inProfile.has(id)) return inProfile.get(id);
    const arr = Array.from({ length: 24 }, () => ({ c: 0, n: 0 }));
    for (const [b, o] of trend.get(id) || []) {
      if (b < midnight || b >= upto || !o.ns) continue;
      const h = Math.min(23, Math.floor((b - midnight) / HOUR));
      arr[h].n += o.ns; arr[h].c += o.c * (o.ns / o.n);
    }
    inProfile.set(id, arr);
    return arr;
  };
  const typ = (id, h) => typicalFlow(profiles, id, day * 24 + Math.min(23, h), skipOf(id)[Math.min(23, h)]);

  const dirs = { in: emptyDir(), out: emptyDir() };
  const gates = [];
  for (const g of list) {
    const row = { key: g.key, road: g.road, place: g.place };
    for (const d of ['in', 'out']) {
      const id = g[d];
      if (!id) { row[d] = null; continue; }
      const D = dirs[d];
      const s = byId.get(id);
      D.gates++;

      // Τώρα
      const now = s?.online && s.flow !== null ? s.flow : null;
      const tNow = typ(id, a.hour);
      if (now !== null) {
        D.online++;
        D.now += now;
        if (tNow !== null) { D.nowSame += now; D.typNowSame += tNow; }
      } else if (tNow !== null) D.now += tNow; // λείπει η μέτρηση: η συνηθισμένη τιμή

      // Από τα μεσάνυχτα, δεκάλεπτο προς δεκάλεπτο
      const m = trend.get(id);
      const hs = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
      let today = 0, measured = 0, mSame = 0, tSame = 0;
      for (let b = midnight; b < lastBucket; b += BUCKET) {
        const h = Math.min(23, Math.floor((b - midnight) / HOUR));
        const o = m?.get(b);
        const v = o && o.n ? o.c / o.n : null;
        const t = typ(id, h);
        if (v !== null) {
          today += v * PER_BUCKET; measured += v * PER_BUCKET;
          hs[h].s += v; hs[h].n++;
          if (t !== null) { mSame += v; tSame += t; }
        } else if (t !== null) today += t * PER_BUCKET;
      }
      D.today += today; D.measured += measured; D.mSame += mSame; D.tSame += tSame;

      // Ώρα με την ώρα: μετρημένη μέση ροή, αλλιώς η συνηθισμένη
      for (let h = 0; h < 24; h++) {
        const t = typ(id, h);
        if (t !== null) { D.typHours[h] += t; D.typGates[h]++; }
        if (h > a.hour) continue;
        if (hs[h].n) { D.hours[h] += hs[h].s / hs[h].n; D.hourMeasured[h]++; } else if (t !== null) D.hours[h] += t;
      }
      for (let h = 0; h < a.hour; h++) D.typToday += typ(id, h) ?? 0;
      D.typToday += (typ(id, a.hour) ?? 0) * (a.minute / 60);

      row[d] = {
        id, online: now !== null, now: round(now, 10), typicalNow: round(tNow, 10), vsNow: pct(now, tNow),
        today: round(today, 100), vsToday: tSame ? pct(mSame, tSame) : null,
      };
    }
    gates.push(row);
  }

  const out = { day, hour: a.hour, minute: a.minute, midnight: new Date(midnight).toISOString(), gates };
  for (const d of ['in', 'out']) {
    const D = dirs[d];
    const enough = (n) => D.gates && n >= Math.ceil(D.gates * MIN_MEASURED);
    out[d] = {
      gates: D.gates, online: D.online,
      now: D.gates ? round(D.now, 10) : null,
      // η σύγκριση μόνο αν οι σταθμοί που μετρούν τώρα και έχουν ιστορικό είναι η μεγάλη πλειονότητα
      vsNow: D.typNowSame && D.nowSame >= D.now * 0.7 ? pct(D.nowSame, D.typNowSame) : null,
      today: round(D.today, 100),
      typicalToday: D.typToday ? round(D.typToday, 100) : null,
      vsToday: D.tSame ? pct(D.mSame, D.tSame) : null,
      measuredShare: D.today ? Math.round((100 * D.measured) / D.today) : null,
      hours: D.hours.map((v, h) => (h <= a.hour && enough(D.hourMeasured[h]) ? round(v, 10) : null)),
      typicalHours: D.typHours.map((v, h) => (enough(D.typGates[h]) ? round(v, 10) : null)),
    };
  }
  return out;
}

function emptyDir() {
  return {
    gates: 0, online: 0, now: 0, nowSame: 0, typNowSame: 0,
    today: 0, measured: 0, typToday: 0, mSame: 0, tSame: 0,
    hours: Array(24).fill(0), hourMeasured: Array(24).fill(0),
    typHours: Array(24).fill(0), typGates: Array(24).fill(0),
  };
}
