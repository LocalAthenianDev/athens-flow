// Κάθε σταθμός παίρνει κατεύθυνση ως προς την Αθήνα: «προς» (in), «από» (out) ή «εγκάρσια» (cross).
// 1. Αν η περιγραφή θέσης λέει «κατεύθυνση Αθήνα / Κέντρο / Ομόνοια / Σύνταγμα», είναι «προς».
// 2. Αν λέει άλλο γνωστό προορισμό (Πειραιά, Λαμία, Κηφισιά…), συγκρίνουμε την πορεία προς εκείνον
//    με την πορεία προς το κέντρο της Αθήνας.
// 3. Αλλιώς χρησιμοποιούμε το πεδίο κατεύθυνσης (kat_si) του σταθμού.
// Γωνία έως 60° από την ευθεία προς το κέντρο = «προς», πάνω από 120° = «από», ενδιάμεσα = «εγκάρσια».
import { bearing, angleDiff, CENTRE } from './geo.js';
import { greek } from './clean.js';

const DEST = {
  'ΠΕΙΡΑΙΑ': [23.647, 37.943], 'ΛΑΜΙΑ': [23.79, 38.25], 'ΚΗΦΙΣΙΑ': [23.811, 38.074], 'ΒΟΥΛΙΑΓΜΕΝΗ': [23.777, 37.81],
  'ΓΛΥΦΑΔΑ': [23.753, 37.862], 'ΑΓ. ΠΑΡΑΣΚΕΥΗ': [23.82, 38.012], 'ΚΑΡΕΑ': [23.782, 37.955], 'ΔΑΦΝΙ': [23.636, 38.012],
  'ΔΕΛΤΑ ΦΑΛΗΡΟΥ': [23.685, 37.94], 'ΑΛΙΜΟ': [23.72, 37.913], 'ΝΙΚΑΙΑ': [23.647, 37.966], 'ΕΛΕΥΣΙΝΑ': [23.54, 38.04],
  'ΚΟΡΙΝΘΟ': [23.3, 38.0], 'ΜΑΡΟΥΣΙ': [23.805, 38.05], 'ΧΑΛΑΝΔΡΙ': [23.8, 38.02], 'ΒΟΥΛΑ': [23.76, 37.84],
  'ΒΟΡΕΙΑ': [23.75, 38.3], 'ΑΝΑΤΟΛΙΚΑ': [24.1, 37.98], 'ΝΟΤΙΑ': [23.73, 37.7], 'ΔΥΤΙΚΑ': [23.4, 37.98],
  'Σ.Ε.Φ.': [23.667, 37.942], 'ΓΟΥΔΙ': [23.77, 37.985],
};
const DEST_NAMES = Object.keys(DEST).sort((a, b) => b.length - a.length);
const IN_WORDS = /^(ΠΡΟΣ )?(ΤΗΝ |ΤΟ )?(ΑΘΗΝΑ|ΚΕΝΤΡΟ|ΟΜΟΝΟΙΑ|ΣΥΝΤΑΓΜΑ)/;

const byAngle = (d) => (d <= 60 ? 'in' : d >= 120 ? 'out' : 'cross');

export function classify(st) {
  if (st.lat === null || st.lon === null) return { dir: null, how: null, arrow: st.heading };
  const here = [st.lon, st.lat];
  const toCentre = bearing(here, CENTRE);
  const m = greek(st.desc || '').match(/ΚΑΤΕΥΘΥΝΣΗ\s+(.*)$/);
  const tail = m ? m[1] : '';
  if (IN_WORDS.test(tail)) {
    // Όπου το kat_si διαφωνεί έντονα με την περιγραφή, το βέλος δείχνει προς τον προορισμό
    const target = /ΟΜΟΝΟΙΑ/.test(tail) ? [23.728, 37.9841] : /ΣΥΝΤΑΓΜΑ/.test(tail) ? [23.7353, 37.9755] : CENTRE;
    const b = bearing(here, target);
    const arrow = st.heading !== null && angleDiff(st.heading, b) <= 100 ? st.heading : Math.round(b);
    return { dir: 'in', how: 'text', arrow };
  }
  const t = tail.replace(/^ΠΡΟΣ\s+/, '');
  const name = DEST_NAMES.find((n) => t.startsWith(n));
  if (name) {
    const b = bearing(here, DEST[name]);
    return { dir: byAngle(angleDiff(b, toCentre)), how: 'dest', arrow: st.heading !== null && angleDiff(st.heading, b) <= 75 ? st.heading : Math.round(b) };
  }
  if (st.heading !== null) return { dir: byAngle(angleDiff(st.heading, toCentre)), how: 'heading', arrow: st.heading };
  return { dir: null, how: null, arrow: null };
}
