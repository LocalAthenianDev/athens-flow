// Έλεγχος του υπολογισμού των πυλών με συνθετικά δεδομένα: node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGates } from '../lib/gates.js';
import { emptyProfiles } from '../lib/profiles.js';
import { slot } from '../lib/time.js';

const MIN = 60_000, HOUR = 60 * MIN, BUCKET = 10 * MIN;
// Τετάρτη 18/11/2026, 10:30 ώρα Αθήνας (08:30 UTC)
const REF = Date.parse('2026-11-18T08:30:00Z');
const MIDNIGHT = Date.parse('2026-11-17T22:00:00Z');

// Προφίλ: προηγούμενες εβδομάδες με σταθερή ροή `typical` σε κάθε ώρα της Τετάρτης
function profilesWith(ids, typical, samples = 6) {
  const p = emptyProfiles();
  for (const id of ids) {
    const e = (p.st[id] = { n: Array(168).fill(0), s: Array(168).fill(0), o: Array(168).fill(0), c: Array(168).fill(0), h: Array(32).fill(0) });
    for (let h = 0; h < 24; h++) { const i = 2 * 24 + h; e.n[i] = samples; e.c[i] = samples * typical; e.s[i] = samples * 50; }
  }
  p.updated = new Date(MIDNIGHT - MIN).toISOString(); // δεν περιέχουν ακόμη τη σημερινή ημέρα
  return p;
}
// Σειρά δεκαλέπτων από τα μεσάνυχτα ως το ref, με σταθερή ροή `flow` (δύο μετρήσεις ανά δεκάλεπτο)
function trendWith(ids, flow, { skip = () => false } = {}) {
  const t = new Map();
  for (const id of ids) {
    const m = new Map();
    for (let b = MIDNIGHT; b < REF; b += BUCKET) if (!skip(b)) m.set(b, { n: 2, ns: 2, c: 2 * flow, s: 100, o: 10 });
    t.set(id, m);
  }
  return t;
}
const station = (id, flow) => [id, { id, online: true, flow }];

test('όγκος από τα μεσάνυχτα, ροή τώρα και σύγκριση με το συνηθισμένο', () => {
  const list = [{ key: 'a', road: 'Α', place: 'Χ', in: 'A', out: 'B' }];
  const g = computeGates({
    list, ref: REF,
    byId: new Map([station('A', 1200), station('B', 900)]),
    trend: trendWith(['A', 'B'], 1200),
    profiles: profilesWith(['A', 'B'], 1000),
  });
  assert.equal(slot(REF), 2 * 24 + 10);
  assert.equal(g.hour, 10); assert.equal(g.minute, 30);
  // 10,5 ώρες × 1200 οχ./ώρα
  assert.equal(g.in.today, 12600);
  assert.equal(g.in.now, 1200);
  assert.equal(g.in.vsNow, 20);
  assert.equal(g.in.vsToday, 20);
  assert.equal(g.in.typicalToday, 10500);
  assert.equal(g.in.measuredShare, 100);
  assert.equal(g.out.now, 900);
  assert.equal(g.out.vsNow, -10);
  assert.deepEqual(g.in.hours.slice(0, 11), Array(11).fill(1200));
  assert.equal(g.in.hours[11], null); // το μέλλον δεν δείχνεται
  assert.equal(g.in.typicalHours[23], 1000);
});

test('κενό στη συλλογή: μπαίνει η συνηθισμένη τιμή, η σύγκριση μένει στις μετρήσεις', () => {
  const list = [{ key: 'a', road: 'Α', place: 'Χ', in: 'A', out: null }];
  const gap = (b) => b >= MIDNIGHT + 2 * HOUR && b < MIDNIGHT + 4 * HOUR; // 02:00 με 04:00 χωρίς μετρήσεις
  const g = computeGates({
    list, ref: REF,
    byId: new Map([['A', { id: 'A', online: false, flow: null }]]),
    trend: trendWith(['A'], 1200, { skip: gap }),
    profiles: profilesWith(['A'], 1000),
  });
  assert.equal(g.in.today, 8.5 * 1200 + 2 * 1000);
  assert.equal(g.in.vsToday, 20);
  assert.equal(g.in.measuredShare, Math.round((100 * 8.5 * 1200) / (8.5 * 1200 + 2000)));
  assert.equal(g.in.now, 1000);      // ο σταθμός είναι εκτός: η συνηθισμένη τιμή
  assert.equal(g.in.vsNow, null);    // αλλά καμία σύγκριση χωρίς μέτρηση
  assert.equal(g.in.online, 0);
  assert.equal(g.in.hours[2], null);  // καμία πύλη δεν μέτρησε εκείνη την ώρα: δεν δείχνεται
  assert.equal(g.in.hours[5], 1200);
  assert.equal(g.out.gates, 0);
});

test('τα προφίλ που περιέχουν ήδη τη σημερινή ημέρα δεν συγκρίνουν την ημέρα με τον εαυτό της', () => {
  const list = [{ key: 'a', road: 'Α', place: 'Χ', in: 'A', out: null }];
  const p = profilesWith(['A'], 1000);
  // Τα σημερινά δεκάλεπτα έχουν μπει στα προφίλ: 6 δεκάλεπτα × 2 μετρήσεις ανά ώρα
  for (let h = 0; h <= 10; h++) {
    const i = 2 * 24 + h;
    const k = h < 10 ? 12 : 6;
    p.st.A.n[i] += k; p.st.A.c[i] += k * 1200;
  }
  p.updated = new Date(REF).toISOString();
  const g = computeGates({ list, ref: REF, byId: new Map([station('A', 1200)]), trend: trendWith(['A'], 1200), profiles: p });
  assert.equal(g.in.vsToday, 20);
  assert.equal(g.in.vsNow, 20);
  assert.equal(g.gates[0].in.typicalNow, 1000);
});

test('χωρίς προηγούμενες εβδομάδες δεν υπάρχει σύγκριση', () => {
  const list = [{ key: 'a', road: 'Α', place: 'Χ', in: 'A', out: null }];
  const g = computeGates({ list, ref: REF, byId: new Map([station('A', 1200)]), trend: trendWith(['A'], 1200), profiles: null });
  assert.equal(g.in.today, 12600);
  assert.equal(g.in.vsToday, null);
  assert.equal(g.in.vsNow, null);
  assert.equal(g.in.typicalToday, null);
});
