// Ώρα Αθήνας για ημέρα της εβδομάδας και ώρα της ημέρας.
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Athens', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' });
const DOW = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
export function athens(t) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return { dow: DOW[p.weekday], hour: Number(p.hour), minute: Number(p.minute), day: `${p.year}-${p.month}-${p.day}` };
}
// Θέση στον πίνακα 7 × 24 (Δευτέρα 00:00 = 0)
export const slot = (t) => { const a = athens(t); return a.dow * 24 + a.hour; };
