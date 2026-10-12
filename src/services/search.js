// Search in the local index built by the new-content scan (names, paths, authors, text).

const norm = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export function searchIndex(index, query, { courseId, kind, limit = 50 } = {}) {
  const tokens = norm(query).split(/\s+/).filter(Boolean);
  const matches = [];
  for (const [id, course] of Object.entries(index.courses)) {
    if (courseId && Number(id) !== Number(courseId)) continue;
    for (const item of Object.values(course.items)) {
      if (kind && item.kind !== kind) continue;
      const hay = norm(`${item.name} ${item.path} ${item.author ?? ''} ${item.text ?? ''}`);
      if (tokens.every((t) => hay.includes(t))) matches.push({ course: { id: Number(id), fullname: course.name }, ...item });
    }
  }
  const scans = Object.values(index.courses).map((c) => c.scannedAt).filter(Boolean);
  return { total: matches.length, lastScan: scans.length ? new Date(Math.min(...scans)).toISOString() : null, matches: matches.slice(0, limit) };
}
