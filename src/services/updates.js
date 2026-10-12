// What's new: a scan of every course in a handful of batched web service calls, compared with
// the stored index, or with a date when `since` is given. Nothing is opened as "viewed".

import { BASE } from '../config.js';
import { IcorsiError } from '../errors.js';
import { compact, decode, toIso } from '../util/text.js';
import { htmlToText, htmlLinks } from '../util/html.js';
import { fileKey } from '../util/url.js';
import { loadIndex, saveIndex, mergeScan } from '../store/index-store.js';
import { mapFiles } from './common.js';
import { getCourses } from './courses.js';
import { mapDiscussion, mapPost, postsCall } from './modules/forum.js';

const TEXT = 300;

/** Index items of one course from its raw contents: activities, files, links, book chapters, label/page text */
export function contentItems(sections, pagesByCmid = new Map()) {
  const items = {};
  const add = (key, item) => { items[key] ??= compact(item); };
  for (const s of sections) {
    const section = decode(s.name);
    const summary = htmlLinks(s.summary);
    for (const f of summary.files) add(`file:${fileKey(f.url)}`, { kind: 'file', name: f.name, url: f.url, path: section });
    for (const l of summary.links) add(`link:${l.url}`, { kind: 'link', name: l.name, url: l.url, path: section });
    for (const m of s.modules ?? []) {
      const name = decode(m.name);
      const where = `${section} > ${name}`;
      const html = m.modname === 'page' ? pagesByCmid.get(m.id)?.content : m.description;
      add(`activity:${m.id}`, { kind: 'activity', type: m.modname, name, url: m.url, path: section, text: htmlToText(html, { max: TEXT }) });
      if (m.uservisible === false) continue;
      const inline = htmlLinks(html);
      // book and page contents are their own HTML and images: only the files they link count
      const files = ['book', 'page'].includes(m.modname) ? inline.files : [...mapFiles(m.contents), ...inline.files];
      for (const f of files) add(`file:${fileKey(f.url)}`, { kind: 'file', name: f.name, url: f.url, path: where, date: f.modified });
      const target = m.modname === 'url' ? m.contents?.find((c) => c.type === 'url')?.fileurl : undefined;
      if (target) add(`link:${m.id}:${target}`, { kind: 'link', name, url: target, path: section });
      // labels live on the course page: v1 indexed their links without the activity id
      const label = m.modname === 'label';
      for (const l of inline.links) add(label ? `link:${l.url}` : `link:${m.id}:${l.url}`, { kind: 'link', name: l.name, url: l.url, path: label ? section : where });
      if (m.modname === 'book') {
        for (const c of m.contents ?? []) {
          if (c.filename !== 'index.html') continue;
          const url = `${BASE}/mod/book/view.php?id=${m.id}&chapterid=${c.filepath.replaceAll('/', '')}`;
          add(`page:${url}`, { kind: 'page', name: decode(c.content), url, path: where, date: toIso(c.timemodified) });
        }
      }
    }
  }
  return items;
}

/**
 * Scans the courses: contents, forums, discussions, and posts only of the discussions that
 * changed (known[courseId][discussionId] = timemodified of the last scan, or newer than `since`).
 */
async function scan(ctx, courses, { known = {}, since } = {}) {
  const ids = courses.map((c) => c.id);
  const [contents, [forums, pages]] = await Promise.all([
    ctx.ws.batch(ids.map((courseid) => ({ fn: 'core_course_get_contents', args: { courseid } }))),
    ctx.ws.batch([
      { fn: 'mod_forum_get_forums_by_courses', args: { courseids: ids } },
      { fn: 'mod_page_get_pages_by_courses', args: { courseids: ids } },
    ]),
  ]);
  const forumList = forums.data ?? [];
  const pagesByCmid = new Map((pages.data?.pages ?? []).map((p) => [p.coursemodule, p]));
  const lists = await ctx.ws.batch(forumList.map((f) => ({ fn: 'mod_forum_get_forum_discussions', args: { forumid: f.id } })));
  const stale = forumList.flatMap((f, i) => (lists[i].data?.discussions ?? [])
    .filter((d) => (since ? d.timemodified > since : known[f.course]?.[d.discussion] !== d.timemodified))
    .map((d) => d.discussion));
  const posts = await ctx.ws.batch(stale.map((id) => postsCall(id)));
  const postsOf = new Map(stale.map((id, i) => [id, posts[i]]));

  return courses.map((course, ci) => {
    if (contents[ci].error) return { course, failed: contents[ci].error.message };
    const sections = contents[ci].data ?? [];
    const items = contentItems(sections, pagesByCmid);
    const paths = new Map(sections.flatMap((s) => (s.modules ?? []).map((m) => [m.id, `${decode(s.name)} > ${decode(m.name)}`])));
    const stamps = {};
    const errors = [];
    forumList.forEach((f, i) => {
      if (f.course !== course.id) return;
      if (lists[i].error) { errors.push({ activity: decode(f.name), error: lists[i].error.message }); return; }
      const where = paths.get(f.cmid) ?? decode(f.name);
      for (const d of lists[i].data.discussions) {
        const disc = mapDiscussion(d);
        items[`discussion:${disc.id}`] ??= compact({ kind: 'discussion', name: disc.title, author: disc.author, url: disc.url, path: where, date: disc.modified });
        stamps[disc.id] = d.timemodified;
        const p = postsOf.get(disc.id);
        if (!p) continue;
        if (p.error) {
          errors.push({ activity: disc.title, error: p.error.message });
          delete stamps[disc.id]; // try again next time
          continue;
        }
        const inDiscussion = `${where} > ${disc.title}`;
        for (const post of p.data.posts.map(mapPost)) {
          items[`post:${post.id}`] ??= compact({ kind: 'post', name: post.subject, author: post.author, date: post.date, url: post.url, path: inDiscussion, text: post.text?.slice(0, TEXT) });
          for (const file of post.files ?? []) items[`file:${fileKey(file.url)}`] ??= compact({ kind: 'file', name: file.name, url: file.url, path: inDiscussion });
        }
      }
    });
    return { course, items, stamps, errors };
  });
}

const head = (c) => ({ id: c.id, fullname: c.fullname, url: c.url });

async function newSince(ctx, courses, since) {
  const sinceSec = Math.floor(new Date(since).getTime() / 1000);
  if (!Number.isFinite(sinceSec)) throw new IcorsiError(`Invalid date: ${since} (use an ISO date such as 2026-10-11)`);
  const sinceIso = new Date(sinceSec * 1000).toISOString();
  const [scans, updates] = await Promise.all([
    scan(ctx, courses, { since: sinceSec }),
    ctx.ws.batch(courses.map((c) => ({ fn: 'core_course_get_updates_since', args: { courseid: c.id, since: sinceSec } }))),
  ]);
  return scans.map(({ course, items, errors, failed }, i) => {
    if (failed) return { course: head(course), error: failed };
    // activities carry no date in the contents: core_course_get_updates_since says which changed
    const changed = new Set((updates[i].data?.instances ?? [])
      .filter((x) => x.contextlevel === 'module' && x.updates.some((u) => u.name === 'configuration' && u.timeupdated > sinceSec))
      .map((x) => x.id));
    const newItems = Object.entries(items)
      .filter(([key, item]) => (item.kind === 'activity' ? changed.has(Number(key.slice('activity:'.length))) : Boolean(item.date && item.date > sinceIso)))
      .map(([, item]) => item);
    return { course: head(course), since: sinceIso, newItems, ...(errors.length && { errors }) };
  });
}

/**
 * New content of the enrolled courses (or one). Without `since`: compared with the previous scan
 * (stored in the index unless markSeen is false). With `since`: everything newer than that date.
 */
export async function findNewContent(ctx, { courseId, markSeen = true, since, indexFile } = {}) {
  let courses = await getCourses(ctx);
  if (courseId) courses = courses.filter((c) => c.id === Number(courseId));
  if (!courses.length) throw new IcorsiError(courseId ? `Not enrolled in course ${courseId}` : 'No enrolled courses');
  if (since) return newSince(ctx, courses, since);

  const index = loadIndex(indexFile);
  const known = Object.fromEntries(Object.entries(index.courses).map(([id, c]) => [id, c.discussions ?? {}]));
  const now = Date.now();
  const result = (await scan(ctx, courses, { known })).map(({ course, items, stamps, errors, failed }) => {
    if (failed) return { course: head(course), error: failed }; // contents unreadable: the index is left alone
    const { baseline, fresh } = mergeScan(index, course, items, { now, stamps });
    return { course: head(course), baseline, totalItems: Object.keys(index.courses[course.id].items).length, newItems: fresh, ...(errors.length && { errors }) };
  });
  if (markSeen) saveIndex(index, indexFile);
  return result;
}
