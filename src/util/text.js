// Text helpers for Moodle data.

// Moodle web services return names with HTML entities (dell&#39;educazione)
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»' };

export function decode(s) {
  if (s == null) return s;
  return String(s).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
    if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
    return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  });
}

export const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Unix seconds -> ISO date; 0 and null mean "not set" in Moodle */
export const toIso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);

/** Drops null, undefined, '' and [] so tool output stays short (false and 0 are kept) */
export function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length)));
}
