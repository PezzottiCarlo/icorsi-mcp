// Courses: the enrolled list, one course with its sections and activities, the catalogue, recent items.

import { BASE } from '../config.js';
import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';
import { completionOf, datesOf, mapFiles } from './common.js';

export const enrolledArgs = (classification = 'all') => ({ classification, limit: 0, offset: 0, sort: 'fullname' });

export const slimCourse = (c) => compact({
  id: c.id,
  fullname: decode(c.fullname),
  shortname: c.shortname,
  category: decode(c.coursecategory ?? c.categoryname),
  url: c.viewurl ?? `${BASE}/course/view.php?id=${c.id}`,
  start: toIso(c.startdate),
  end: toIso(c.enddate),
  progress: c.hasprogress ? c.progress : undefined,
  favourite: c.isfavourite || undefined,
  hidden: c.hidden || undefined,
});

export const slimRecent = (i) => compact({
  id: i.cmid,
  type: i.modname,
  name: decode(i.name),
  course: decode(i.coursename),
  url: i.viewurl,
  accessed: toIso(i.timeaccess),
});

// Files, link and label text come inline so most questions need no icorsi_get_activity
export const slimModule = (m) => compact({
  id: m.id,
  type: m.modname,
  name: decode(m.name),
  url: m.url,
  visible: m.uservisible === false ? false : undefined,
  completion: completionOf(m),
  dates: datesOf(m),
  text: m.modname === 'label' ? htmlToText(m.description, { max: 2000 }) : undefined,
  link: m.modname === 'url' ? m.contents?.find((c) => c.type === 'url')?.fileurl : undefined,
  files: ['resource', 'folder', 'imscp'].includes(m.modname) ? mapFiles(m.contents) : undefined,
});

export const slimSections = (sections) => sections.map((s) => compact({
  id: s.id,
  number: s.section,
  title: decode(s.name),
  hidden: s.uservisible === false || s.visible === 0 ? true : undefined,
  summary: htmlToText(s.summary, { max: 2000 }),
  activities: (s.modules ?? []).map(slimModule),
}));

/** Raw core_course_get_contents of a course, cached for a minute (get_course -> get_activity bursts) */
export const rawContents = (ctx, courseId) => ctx.cache.get(`contents:${courseId}`, () => ctx.ws.call('core_course_get_contents', { courseid: Number(courseId) }));

export async function getCourses(ctx, { classification = 'all' } = {}) {
  const data = await ctx.ws.call('core_course_get_enrolled_courses_by_timeline_classification', enrolledArgs(classification));
  return data.courses.map(slimCourse);
}

/** Course details plus every section and activity */
export async function getCourse(ctx, courseId) {
  const id = Number(courseId);
  const [info, contents] = await Promise.all([
    ctx.ws.call('core_course_get_courses_by_field', { field: 'id', value: id }),
    rawContents(ctx, id),
  ]);
  const c = info.courses?.[0] ?? {};
  return compact({
    id,
    fullname: decode(c.fullname),
    shortname: c.shortname,
    category: decode(c.categoryname),
    url: `${BASE}/course/view.php?id=${id}`,
    summary: htmlToText(c.summary, { max: 3000 }),
    teachers: (c.contacts ?? []).map((t) => t.fullname),
    start: toIso(c.startdate),
    end: toIso(c.enddate),
    format: c.format,
    sections: slimSections(contents),
  });
}

/** The whole iCorsi catalogue, also courses the user is not enrolled in */
export async function searchCourses(ctx, query, { page = 0, perPage = 20 } = {}) {
  const r = await ctx.ws.call('core_course_search_courses', { criterianame: 'search', criteriavalue: query, page, perpage: perPage });
  return {
    total: r.total,
    courses: r.courses.map((c) => compact({
      id: c.id,
      fullname: decode(c.fullname),
      shortname: c.shortname,
      category: decode(c.categoryname),
      summary: htmlToText(c.summary, { max: 500 }),
      teachers: (c.contacts ?? []).map((t) => t.fullname),
      enrolment: c.enrollmentmethods,
      url: `${BASE}/course/view.php?id=${c.id}`,
    })),
  };
}

export async function getRecentItems(ctx, { limit = 10 } = {}) {
  const items = await ctx.ws.call('block_recentlyaccesseditems_get_recent_items', { limit });
  return items.map(slimRecent);
}
