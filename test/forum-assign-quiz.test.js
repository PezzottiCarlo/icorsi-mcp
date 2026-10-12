import test from 'node:test';
import assert from 'node:assert/strict';
import { mapPost, mapDiscussion, forum, getDiscussion } from '../src/services/modules/forum.js';
import { assign } from '../src/services/modules/assign.js';
import { quiz, quizReview } from '../src/services/modules/quiz.js';
import { getActivity } from '../src/services/activities.js';
import { HANDLERS } from '../src/services/modules/index.js';
import { fakeCtx } from './helpers.js';

const post = (id, extra = {}) => ({
  id, subject: `Re: Tema ${id}`, message: '<p>Testo <a href="https://example.org/p">fonte</a></p>', author: { id: 3, fullname: 'Mario Rossi' },
  discussionid: 155947, parentid: null, timecreated: 1791395156, timemodified: 1791395156, isprivatereply: false, attachments: [], ...extra,
});

test('mapPost and mapDiscussion', () => {
  assert.deepEqual(mapPost(post(1, { parentid: 7, timemodified: 1791795443, attachments: [{ filename: 'a.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_forum/attachment/1/a.pdf', filesize: 10, mimetype: 'application/pdf' }] })), {
    id: 1, subject: 'Re: Tema 1', author: 'Mario Rossi', date: '2026-10-07T17:45:56.000Z', edited: '2026-10-12T08:57:23.000Z', parent: 7, text: 'Testo fonte',
    files: [{ name: 'a.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_forum/attachment/1/a.pdf', size: 10, mimetype: 'application/pdf' }],
    links: [{ name: 'fonte', url: 'https://example.org/p' }],
    url: 'https://www.icorsi.ch/mod/forum/discuss.php?d=155947#p1',
  });
  assert.deepEqual(mapDiscussion({ discussion: 155947, name: 'Lezione &amp; attività', userfullname: 'Mario Rossi', created: 1791395156, timemodified: 1791395156, numreplies: 0, numunread: 0, pinned: false, locked: false }), {
    id: 155947, title: 'Lezione & attività', author: 'Mario Rossi', created: '2026-10-07T17:45:56.000Z', modified: '2026-10-07T17:45:56.000Z', replies: 0, url: 'https://www.icorsi.ch/mod/forum/discuss.php?d=155947',
  });
});

test('forum returns every discussion with its posts, settling failures', async () => {
  const ctx = fakeCtx({ ws: {
    mod_forum_get_forums_by_courses: [{ id: 42514, cmid: 50, course: 9, type: 'news', intro: '<p>Annunci del corso</p>' }],
    mod_forum_get_forum_discussions: { discussions: [
      { discussion: 1, name: 'A', created: 1, timemodified: 1, numreplies: 1 },
      { discussion: 2, name: 'B', created: 1, timemodified: 1, numreplies: 0 },
    ] },
    mod_forum_get_discussion_posts: ({ discussionid }) => (discussionid === 2 ? new Error('Discussion hidden') : { posts: [post(10, { discussionid: 1 })] }),
  } });
  const out = await forum(ctx, { id: 50, course: 9, instance: 42514, modname: 'forum' });
  assert.equal(out.forumType, 'news');
  assert.equal(out.intro, 'Annunci del corso');
  assert.deepEqual(out.discussions[0].posts.map((p) => p.id), [10]);
  assert.equal(out.discussions[1].error, 'Discussion hidden');
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_forum_get_forum_discussions').args, { forumid: 42514 });
});

test('getDiscussion returns the posts of one discussion, also from a discuss.php URL', async () => {
  const ctx = fakeCtx({ ws: { mod_forum_get_discussion_posts: { forumid: 42514, courseid: 9, posts: [post(10)] } } });
  const d = await getDiscussion(ctx, 155947);
  assert.deepEqual({ ...d, posts: d.posts.length }, { type: 'discussion', id: 155947, forum: 42514, course: 9, url: 'https://www.icorsi.ch/mod/forum/discuss.php?d=155947', posts: 1 });
  assert.deepEqual(ctx.calls[0].args, { discussionid: 155947, sortby: 'created', sortdirection: 'ASC' });
  assert.equal((await getActivity(ctx, 'https://www.icorsi.ch/mod/forum/discuss.php?d=155947#p10')).type, 'discussion');
});

test('assign returns dates, my submission, feedback and comments', async () => {
  const ctx = fakeCtx({ ws: {
    mod_assign_get_assignments: { courses: [{ id: 9, assignments: [{ id: 69142, cmid: 50, name: 'Consegna', intro: '<p>Carica il PDF</p>', introfiles: [],
      introattachments: [{ filename: 'traccia.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_assign/introattachment/0/traccia.pdf' }],
      allowsubmissionsfromdate: 1791395156, duedate: 1794178740, cutoffdate: 0, grade: 100, timelimit: 0, teamsubmission: 0 }] }] },
    mod_assign_get_submission_status: {
      lastattempt: { submission: { id: 1461571, status: 'submitted', timecreated: 1791395156, timemodified: 1791795443, plugins: [
        { type: 'file', fileareas: [{ area: 'submission_files', files: [{ filename: 'mio.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/assignsubmission_file/submission_files/1/mio.pdf' }] }] },
        { type: 'onlinetext', editorfields: [{ text: '<p>Il mio testo</p>' }] },
        { type: 'comments' },
      ] }, gradingstatus: 'graded', locked: false, extensionduedate: null },
      feedback: { gradefordisplay: '<span>85,00 / 100,00</span>', gradeddate: 1791795443, plugins: [{ type: 'comments', editorfields: [{ text: '<p>Ottimo lavoro</p>' }] }, { type: 'file', fileareas: [{ files: [] }] }] },
    },
    core_comment_get_comments: { comments: [{ fullname: 'Mario Rossi', timecreated: 1791795443, content: '<p>Visto</p>' }] },
  } });
  assert.deepEqual(await assign(ctx, { id: 50, course: 9, instance: 69142, modname: 'assign' }), {
    intro: 'Carica il PDF',
    attachments: [{ name: 'traccia.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_assign/introattachment/0/traccia.pdf' }],
    opens: '2026-10-07T17:45:56.000Z',
    due: '2026-11-08T22:59:00.000Z',
    maxGrade: 100,
    submission: {
      status: 'submitted', grading: 'graded', modified: '2026-10-12T08:57:23.000Z', text: 'Il mio testo',
      files: [{ name: 'mio.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/assignsubmission_file/submission_files/1/mio.pdf' }],
      comments: [{ author: 'Mario Rossi', date: '2026-10-12T08:57:23.000Z', text: 'Visto' }],
    },
    feedback: { grade: '85,00 / 100,00', graded: '2026-10-12T08:57:23.000Z', comments: 'Ottimo lavoro' },
  });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'core_comment_get_comments').args, { contextlevel: 'module', instanceid: 50, component: 'assignsubmission_comments', itemid: 1461571, area: 'submission_comments' });
});

test('assign without a submission yet, comments disabled', async () => {
  const ctx = fakeCtx({ ws: {
    mod_assign_get_assignments: { courses: [{ id: 9, assignments: [{ id: 1, cmid: 50, duedate: 0, grade: 0 }] }] },
    mod_assign_get_submission_status: { lastattempt: { submission: { id: 5, status: 'new', timecreated: 1, timemodified: 1, plugins: [] }, gradingstatus: 'notgraded' } },
    core_comment_get_comments: new Error('comments disabled'),
  } });
  assert.deepEqual(await assign(ctx, { id: 50, course: 9, instance: 1, modname: 'assign' }), { submission: { status: 'new', grading: 'notgraded' } });
});

test('quiz returns rules, attempts, best grade and feedback', async () => {
  const ctx = fakeCtx({ ws: {
    mod_quiz_get_quizzes_by_courses: { quizzes: [{ id: 33002, coursemodule: 50, intro: '<p>Leggi la voce</p>', introfiles: [], timeopen: 0, timeclose: 0, timelimit: 600, attempts: 1, grade: 10, hasfeedback: 1 }] },
    mod_quiz_get_user_attempts: { attempts: [{ id: 1028729, attempt: 1, state: 'finished', timestart: 1791395156, timefinish: 1791795443, sumgrades: 8 }] },
    mod_quiz_get_user_best_grade: { hasgrade: true, grade: 8 },
    mod_quiz_get_quiz_access_information: { accessrules: ['Attempts allowed: 1'], preventaccessreasons: [] },
    mod_quiz_get_quiz_feedback_for_grade: { feedbacktext: '<p>Bene</p>' },
  } });
  assert.deepEqual(await quiz(ctx, { id: 50, course: 9, instance: 33002, modname: 'quiz' }), {
    intro: 'Leggi la voce', timeLimit: 600, attemptsAllowed: 1, maxGrade: 10, bestGrade: 8, feedback: 'Bene', rules: ['Attempts allowed: 1'],
    attempts: [{ id: 1028729, number: 1, state: 'finished', started: '2026-10-07T17:45:56.000Z', finished: '2026-10-12T08:57:23.000Z', score: 8 }],
  });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_quiz_get_quiz_feedback_for_grade').args, { quizid: 33002, grade: 8 });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_quiz_get_user_attempts').args, { quizid: 33002, status: 'all', includepreviews: false });
});

test('quizReview returns each question as text without the flag widget', async () => {
  const ctx = fakeCtx({ ws: { mod_quiz_get_attempt_review: {
    grade: 10,
    attempt: { id: 1028729, attempt: 1, state: 'finished', timestart: 1791395156, timefinish: 1791795443, sumgrades: null },
    additionaldata: [{ id: 'feedback', title: 'Feedback', content: '<p>Porta due domande</p>' }],
    questions: [{ slot: 1, number: 1, questionnumber: '1', type: 'multichoice', status: 'Correct', state: 'gradedright', mark: '1.00', maxmark: 1,
      html: '<div class="que"><div class="info"><h3>Question 1</h3><div class="questionflag">Flag question</div></div>'
        + '<div class="formulation"><p>Che cosa significa ex-ducere?</p><div class="answer"><label>A. Trasmettere</label><label>B. Far emergere</label></div></div>'
        + '<div class="outcome"><div class="rightanswer">La risposta corretta è: Far emergere</div></div></div>' }],
  } } });
  const r = await quizReview(ctx, 1028729);
  assert.equal(r.grade, 10);
  assert.deepEqual(r.feedback, [{ title: 'Feedback', text: 'Porta due domande' }]);
  assert.equal(r.questions[0].status, 'Correct');
  assert.equal(r.questions[0].number, '1');
  assert.doesNotMatch(r.questions[0].text, /Flag question/);
  assert.match(r.questions[0].text, /Che cosa significa ex-ducere\?/);
  assert.match(r.questions[0].text, /La risposta corretta è: Far emergere/);
  assert.deepEqual(ctx.calls[0].args, { attemptid: 1028729, page: -1 });
});

test('the registry knows forum, assign and quiz', () => {
  assert.equal(HANDLERS.forum, forum);
  assert.equal(HANDLERS.assign, assign);
  assert.equal(HANDLERS.quiz, quiz);
});
