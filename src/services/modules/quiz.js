// Quizzes: rules, my attempts, best grade with its feedback, and the review of one attempt.

import { compact, toIso } from '../../util/text.js';
import { htmlToText } from '../../util/html.js';
import { instanceOf, introOf } from '../common.js';

// Widgets of the review page that are not part of the question
const NOISE = '.questionflag, .questionflagsaveform, .accesshide, .sr-only, input';

export const mapAttempt = (a) => compact({
  id: a.id,
  number: a.attempt,
  state: a.state,
  started: toIso(a.timestart),
  finished: toIso(a.timefinish),
  score: a.sumgrades ?? undefined,
});

export async function quiz(ctx, cm) {
  const q = await instanceOf(ctx, 'mod_quiz_get_quizzes_by_courses', 'quizzes', cm);
  const [attempts, best, access] = await ctx.ws.batch([
    { fn: 'mod_quiz_get_user_attempts', args: { quizid: cm.instance, status: 'all', includepreviews: false } },
    { fn: 'mod_quiz_get_user_best_grade', args: { quizid: cm.instance } },
    { fn: 'mod_quiz_get_quiz_access_information', args: { quizid: cm.instance } },
  ]);
  const bestGrade = best.data?.hasgrade ? best.data.grade : undefined;
  let feedback;
  if (bestGrade != null && q?.hasfeedback) {
    const r = await ctx.ws.call('mod_quiz_get_quiz_feedback_for_grade', { quizid: cm.instance, grade: bestGrade });
    feedback = htmlToText(r.feedbacktext);
  }
  return compact({
    ...introOf(q),
    opens: toIso(q?.timeopen),
    closes: toIso(q?.timeclose),
    timeLimit: q?.timelimit || undefined,
    attemptsAllowed: q ? q.attempts || 'unlimited' : undefined,
    maxGrade: q?.grade,
    bestGrade,
    feedback,
    rules: access.data?.accessrules,
    blocked: access.data?.preventaccessreasons,
    attempts: attempts.data?.attempts?.map(mapAttempt),
  });
}

export async function quizReview(ctx, attemptId) {
  const r = await ctx.ws.call('mod_quiz_get_attempt_review', { attemptid: Number(attemptId), page: -1 });
  return compact({
    attempt: mapAttempt(r.attempt),
    grade: r.grade ?? undefined,
    feedback: (r.additionaldata ?? []).map((d) => compact({ title: d.title, text: htmlToText(d.content) })),
    questions: r.questions.map((q) => compact({
      number: q.questionnumber ?? q.number,
      type: q.type,
      status: q.status,
      mark: q.mark,
      maxMark: q.maxmark,
      text: htmlToText(q.html, { max: 4000, remove: NOISE }),
    })),
  });
}
