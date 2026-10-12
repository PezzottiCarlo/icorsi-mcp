// Grades: the total of every course, or every grade item of one course.

import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';
import { dash } from './common.js';
import { getCourses } from './courses.js';

export async function getGradesOverview(ctx) {
  const [me, courses] = await Promise.all([ctx.userId(), getCourses(ctx)]);
  const r = await ctx.ws.call('gradereport_overview_get_course_grades', { userid: me });
  const names = new Map(courses.map((c) => [c.id, c.fullname]));
  // grade stays in the output even when null: "no grade yet" is an answer
  return r.grades.map((g) => ({
    course: { id: g.courseid, fullname: names.get(g.courseid) ?? null },
    grade: dash(g.grade),
    ...(g.rawgrade != null && { raw: Number(g.rawgrade) }),
  }));
}

const itemName = (g) => {
  if (g.itemtype === 'course') return 'Course total';
  if (g.itemtype === 'category') return `Category total${g.itemname ? `: ${decode(g.itemname)}` : ''}`;
  return decode(g.itemname);
};

export async function getCourseGrades(ctx, courseId) {
  const id = Number(courseId);
  const r = await ctx.ws.call('gradereport_user_get_grade_items', { courseid: id, userid: await ctx.userId() });
  const items = r.usergrades?.[0]?.gradeitems ?? [];
  return {
    course: id,
    items: items.map((g) => ({
      ...compact({
        name: itemName(g),
        type: g.itemtype,
        module: g.itemmodule ?? undefined,
        cmid: g.cmid ?? undefined,
        range: decode(g.rangeformatted),
        feedback: htmlToText(g.feedback),
        graded: toIso(g.gradedategraded),
        submitted: toIso(g.gradedatesubmitted),
        hidden: g.gradeishidden || undefined,
      }),
      grade: dash(g.gradeformatted),
      percentage: dash(g.percentageformatted),
    })),
  };
}
