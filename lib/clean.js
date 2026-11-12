// Καθαρισμός των εγγραφών του API «Κυκλοφορία δρόμων στην Αττική» (Περιφέρεια Αττικής, data.gov.gr).
// Το API δίνει JSON Lines, μία γραμμή ανά σταθμό μέτρησης, με τους αριθμούς ως κείμενο.

export const SOURCE_URL = process.env.SOURCE_URL || 'https://loader.data.gov.gr/data/attica-region-traffic-data';

// Κατεύθυνση κίνησης (πεδίο kat_si) σε μοίρες. Στα δεδομένα υπάρχουν και λατινικά A, B, N αντί για Α, Β, Ν.
const HEADINGS = { Β: 0, ΒΑ: 45, Α: 90, ΝΑ: 135, Ν: 180, ΝΔ: 225, Δ: 270, ΒΔ: 315 };
const greek = (s) => String(s).trim().toUpperCase().replace(/A/g, 'Α').replace(/B/g, 'Β').replace(/N/g, 'Ν');
export function heading(kat) {
  if (kat === null || kat === undefined) return null;
  const h = HEADINGS[greek(kat)];
  return h === undefined ? null : h;
}

const num = (x) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

// Τύπος θέσης από το όνομα του σταθμού: κύριος δρόμος, ράμπα, παράδρομος, λωρίδα στροφής, λεωφορειολωρίδα.
export function kind(onoma, perigrafi, vehicle) {
  const s = greek(`${String(onoma || '').replace(/^.*? - /, '')} | ${perigrafi || ''}`);
  if (vehicle === 'bus' || /ΛΕΩΦΟΡΕΙΟΛΩΡΙΔΑ/.test(s)) return 'bus';
  const head = s.split('|')[0];
  if (/ΡΑΜΠΑ ΕΙΣΟΔΟΥ|^ΕΙΣΟΔΟΣ/.test(head)) return 'ramp_in';
  if (/ΡΑΜΠΑ ΕΞΟΔΟΥ|^ΕΞΟΔΟΣ/.test(head)) return 'ramp_out';
  if (/ΠΑΡΑΔΡΟΜΟΣ/.test(head)) return 'side';
  if (/ΣΤΡΟΦΗ|ΛΩΡΙΔΑ|ΚΛΑΔΟΣ ΠΡΟΣ|ΑΡΙΣΤΕΡΟΣ ΚΛΑΔΟΣ|ΔΕΞΙΟΣ ΚΛΑΔΟΣ/.test(head)) return 'turn';
  if (/ΚΥΡΙΟΣ ΔΡΟΜΟΣ|ΚΥΡΙΟ ΡΕΥΜΑ|ΚΕΝΤΡΙΚΟΣ ΚΛΑΔΟΣ/.test(head)) return 'main';
  if (/^ΡΑΜΠΑ ΕΙΣΟΔΟΥ/.test(greek(perigrafi || ''))) return 'ramp_in';
  if (/^ΡΑΜΠΑ ΕΞΟΔΟΥ/.test(greek(perigrafi || ''))) return 'ramp_out';
  return 'main';
}

// Ενιαίο όνομα οδού: ίδια λεωφόρος γράφεται με διαφορετικούς τρόπους στα δεδομένα.
const ROAD_ALIASES = {
  'Β. ΣΟΦΙΑΣ': 'ΒΑΣ. ΣΟΦΙΑΣ', 'Π. ΡΑΛΛΗ': 'ΠΕΤΡΟΥ ΡΑΛΛΗ', 'Β. ΑΛΕΞΑΝΔΡΟΥ': 'ΒΑΣ. ΑΛΕΞΑΝΔΡΟΥ',
  'Β. ΚΩΝΣΤΑΝΤΙΝΟΥ': 'ΒΑΣ. ΚΩΝΣΤΑΝΤΙΝΟΥ', 'ΑΘΗΝΩΝ (ΠΑΡΑΛΛΗΛΟΣ)': 'ΑΘΗΝΩΝ',
};
export function road(odos) {
  if (!odos) return null;
  let s = String(odos).trim().replace(/\s+/g, ' ').replace(/^Λ\.\s*/, '').replace(/^ΛΕΩΦ(ΟΡΟΣ|\.)\s*/, '');
  return ROAD_ALIASES[s] || s;
}

// Μία εγγραφή του API → { station, reading }. Επιστρέφει null αν λείπει ο κωδικός ή η ώρα.
export function parseRow(raw) {
  const id = raw.id || raw.MS;
  const t = Date.parse(raw.timestamp);
  if (!id || !Number.isFinite(t)) return null;
  const lat = num(raw.latitude), lon = num(raw.longitude);
  const k = kind(raw.onoma, raw.perigrafi_thesis, raw.vehicle);
  const station = {
    id,
    road: road(raw.odos),
    roadLabel: raw.odos ? String(raw.odos).trim() : null,
    dimos: raw.dimos ? String(raw.dimos).trim() : null,
    desc: raw.perigrafi_thesis ? String(raw.perigrafi_thesis).trim() : null,
    kind: k,
    heading: heading(raw.kat_si),
    lanes: num(raw.anichneytes),
    lat: lat !== null && lat > 37 && lat < 39 ? lat : null,
    lon: lon !== null && lon > 23 && lon < 24.5 ? lon : null,
  };
  let count = num(raw.count), occ = num(raw.occ), speed = num(raw.speed);
  // Τιμές που δεν στέκουν φυσικά φεύγουν
  if (count !== null && (count < 0 || count > 12000)) count = null;
  if (occ !== null && (occ < 0 || occ > 100)) occ = null;
  if (speed !== null && (speed <= 0 || speed > 160)) speed = null;
  return { station, reading: { id, t, count, occ, speed } };
}

export function parseNdjson(text) {
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { const r = parseRow(JSON.parse(line)); if (r) out.push(r); } catch { /* χαλασμένη γραμμή */ }
  }
  return out;
}

export async function fetchSnapshot(etag) {
  const res = await fetch(SOURCE_URL, {
    headers: { 'User-Agent': 'athens-flow (+https://github.com/LocalAthenianDev/athens-flow)', ...(etag ? { 'If-None-Match': etag } : {}) },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 304) return { unchanged: true, etag };
  if (!res.ok) throw new Error(`Το API απάντησε ${res.status}`);
  return { unchanged: false, etag: res.headers.get('etag'), rows: parseNdjson(await res.text()) };
}
