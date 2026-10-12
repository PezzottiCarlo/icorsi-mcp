// Assignments: dates and instructions, my submission, grade and feedback, submission comments.

import { compact, toIso } from '../../util/text.js';
import { htmlToText } from '../../util/html.js';
import { dash, introOf, mapFiles } from '../common.js';

const pluginFiles = (plugins, type) => (plugins ?? [])
  .filter((p) => !type || p.type === type)
  .flatMap((p) => (p.fileareas ?? []).flatMap((a) => mapFiles(a.files)));

const pluginText = (plugins, type) => (plugins ?? [])
  .filter((p) => p.type === type)
  .flatMap((p) => (p.editorfields ?? []).map((f) => htmlToText(f.text)))
  .filter(Boolean)
  .join('\n\n');

export function mapSubmission(last) {
  if (!last) return undefined;
  const sub = last.submission ?? last.teamsubmission;
  return compact({
    status: sub?.status,
    grading: last.gradingstatus,
    modified: sub && sub.timemodified !== sub.timecreated ? toIso(sub.timemodified) : undefined,
    locked: last.locked || undefined,
    extensionDue: toIso(last.extensionduedate),
    text: pluginText(sub?.plugins, 'onlinetext'),
    files: pluginFiles(sub?.plugins, 'file'),
  });
}

export function mapFeedback(fb) {
  if (!fb) return undefined;
  return compact({
    grade: dash(htmlToText(fb.gradefordisplay)),
    graded: toIso(fb.gradeddate),
    comments: pluginText(fb.plugins, 'comments'),
    files: pluginFiles(fb.plugins), // feedback files and annotated PDFs
  });
}

export async function assign(ctx, cm) {
  const [list, status] = await Promise.all([
    ctx.cache.get(`mod_assign_get_assignments:${cm.course}`, () => ctx.ws.call('mod_assign_get_assignments', { courseids: [cm.course] })),
    ctx.ws.call('mod_assign_get_submission_status', { assignid: cm.instance }),
  ]);
  const a = list.courses.flatMap((c) => c.assignments).find((x) => x.cmid === cm.id);
  const submission = mapSubmission(status.lastattempt);
  const submissionId = (status.lastattempt?.submission ?? status.lastattempt?.teamsubmission)?.id;
  let comments;
  if (submissionId) {
    try {
      const r = await ctx.ws.call('core_comment_get_comments', { contextlevel: 'module', instanceid: cm.id, component: 'assignsubmission_comments', itemid: submissionId, area: 'submission_comments' });
      comments = r.comments.map((c) => compact({ author: c.fullname, date: toIso(c.timecreated), text: htmlToText(c.content) }));
    } catch { /* submission comments are disabled for this assignment */ }
  }
  return compact({
    ...introOf(a),
    attachments: mapFiles(a?.introattachments),
    opens: toIso(a?.allowsubmissionsfromdate),
    due: toIso(a?.duedate),
    cutoff: toIso(a?.cutoffdate),
    maxGrade: a?.grade > 0 ? a.grade : undefined,
    timeLimit: a?.timelimit || undefined,
    teamSubmission: a?.teamsubmission ? true : undefined,
    submission: submission && compact({ ...submission, comments }),
    feedback: mapFeedback(status.feedback),
  });
}
