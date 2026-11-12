// Γεωμετρία: αζιμούθιο, απόσταση, σημείο μέσα σε πολύγωνο.
const R = Math.PI / 180;
export const CENTRE = [23.7325, 37.9795]; // ανάμεσα σε Σύνταγμα και Ομόνοια [lon, lat]

export function bearing(a, b) {
  const y = Math.sin((b[0] - a[0]) * R) * Math.cos(b[1] * R);
  const x = Math.cos(a[1] * R) * Math.sin(b[1] * R) - Math.sin(a[1] * R) * Math.cos(b[1] * R) * Math.cos((b[0] - a[0]) * R);
  return (Math.atan2(y, x) / R + 360) % 360;
}
export function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}
export function km(a, b) {
  const dx = (b[0] - a[0]) * R * Math.cos(((a[1] + b[1]) / 2) * R);
  const dy = (b[1] - a[1]) * R;
  return 6371 * Math.sqrt(dx * dx + dy * dy);
}
export function inRing(pt, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// koinotites: [{ id, n, c, r: [ring, ...] }] από τα όρια του Δήμου Αθηναίων
export function communityOf(pt, koinotites) {
  for (const k of koinotites) if (k.r.some((ring) => inRing(pt, ring))) return k.id;
  return null;
}
