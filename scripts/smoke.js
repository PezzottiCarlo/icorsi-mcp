// Live read-only smoke test on your own iCorsi account: npm run smoke
// Calls every feature once (one activity of each type found) and prints size and timing.

import { ICorsi } from '../src/client.js';

const api = new ICorsi();
const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const out = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, bytes: JSON.stringify(out ?? null).length });
    return out;
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - started, error: e.message });
    return null;
  }
}

const home = await check('home', () => api.getHome());
const courses = home?.courses ?? [];
await check('courses', () => api.getCourses());

const seen = new Set();
for (const c of courses) {
  const course = await check(`course ${c.id}`, () => api.getCourse(c.id));
  for (const a of course?.sections?.flatMap((s) => s.activities ?? []) ?? []) {
    if (seen.has(a.type) || a.visible === false) continue;
    seen.add(a.type);
    const activity = await check(`activity ${a.type} ${a.id}`, () => api.getActivity({ cmid: a.id }));
    if (activity?.error) results.push({ name: `  ${a.type} handler`, ok: false, ms: 0, error: activity.error });
    if (a.type === 'quiz' && activity?.attempts?.[0]) await check('quiz review', () => api.getQuizReview(activity.attempts[0].id));
  }
}

await check('search courses', () => api.searchCourses('matematica'));
await check('calendar month', () => api.getCalendarMonth());
await check('calendar day', () => api.getCalendarDay());
await check('calendar upcoming', () => api.getUpcoming());
await check('notifications', () => api.getNotifications());
await check('conversations', () => api.getConversations());
await check('grades', () => api.getGrades());
if (courses[0]) {
  await check('course grades', () => api.getGrades({ courseId: courses[0].id }));
  await check('participants', () => api.getParticipants(courses[0].id));
}
await check('profile', () => api.getProfile());
await check('recent', () => api.getRecentItems());
await check('new content (peek)', () => api.findNewContent({ markSeen: false }));
await check('new content since 7 days', () => api.findNewContent({ since: new Date(Date.now() - 7 * 86400e3).toISOString() }));

for (const r of results) {
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name.padEnd(40)} ${String(r.ms).padStart(6)} ms  ${r.ok ? `${r.bytes} B` : r.error}`);
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} ok`);
process.exit(failed ? 1 : 0);
