// Τυπικό προφίλ κάθε σταθμού: για κάθε ημέρα της εβδομάδας και ώρα (7 × 24, ώρα Αθήνας)
// κρατάμε πλήθος δειγμάτων και αθροίσματα ταχύτητας, κατάληψης και ροής,
// και ένα ιστόγραμμα ταχυτήτων ανά 5 km/h για την ταχύτητα ελεύθερης ροής.
import { slot } from './time.js';

export const SLOTS = 168;
export const BINS = 32; // 0–160 km/h

export function emptyProfiles() {
  return { version: 1, since: null, updated: null, samples: 0, st: {} };
}
function entry(p, id) {
  return (p.st[id] ||= { n: Array(SLOTS).fill(0), s: Array(SLOTS).fill(0), o: Array(SLOTS).fill(0), c: Array(SLOTS).fill(0), h: Array(BINS).fill(0) });
}
export function addReading(p, r) {
  if (r.speed === null) return;
  const e = entry(p, r.id);
  const i = slot(r.t);
  e.n[i]++; e.s[i] += r.speed; e.o[i] += r.occ ?? 0; e.c[i] += r.count ?? 0;
  e.h[Math.min(BINS - 1, Math.floor(r.speed / 5))]++;
  p.samples++;
  const iso = new Date(r.t).toISOString();
  if (!p.since || iso < p.since) p.since = iso;
  if (!p.updated || iso > p.updated) p.updated = iso;
}

// Ταχύτητα ελεύθερης ροής: το 85ο εκατοστημόριο των ταχυτήτων που έχει δείξει ο ίδιος ο σταθμός.
// Χρειάζεται τουλάχιστον 60 δείγματα, αλλιώς null.
export function freeFlow(e, minSamples = 60) {
  if (!e) return null;
  const total = e.h.reduce((a, b) => a + b, 0);
  if (total < minSamples) return null;
  let acc = 0;
  for (let i = 0; i < BINS; i++) {
    acc += e.h[i];
    if (acc >= total * 0.85) return i * 5 + 2.5;
  }
  return null;
}
