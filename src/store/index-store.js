// .state/index.json: everything the new-content scans have seen, per course.

import fs from 'node:fs';
import path from 'node:path';
import { PATHS } from '../config.js';

export const INDEX_VERSION = 2;

export function loadIndex(file = PATHS.index) {
  try {
    const index = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { version: index.version ?? 1, courses: index.courses ?? {} };
  } catch {
    return { version: INDEX_VERSION, courses: {} };
  }
}

export function saveIndex(index, file = PATHS.index) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...index, version: INDEX_VERSION }, null, 2));
}

/**
 * Adds a course scan to the index and returns the items not seen before. The first scan of a
 * course is a baseline: it records everything and reports nothing. `stamps` are the discussions'
 * timemodified, so the next scan only fetches posts of discussions that changed.
 */
export function mergeScan(index, course, items, { now = Date.now(), stamps } = {}) {
  const known = Boolean(index.courses[course.id]);
  const stored = (index.courses[course.id] ??= { items: {} });
  const fresh = [];
  for (const [key, item] of Object.entries(items)) {
    if (stored.items[key]) continue;
    stored.items[key] = { ...item, firstSeen: now };
    if (known) fresh.push(item);
  }
  if (stamps) stored.discussions = { ...stored.discussions, ...stamps };
  Object.assign(stored, { name: course.fullname, url: course.url, scannedAt: now });
  return { baseline: !known, fresh };
}
