import test from 'node:test';
import assert from 'node:assert/strict';
import { board } from '../src/services/modules/board.js';
import { glossary, feedback, choicegroup, choice, wiki, data, lesson, scorm, workshop, h5pactivity, bigbluebuttonbn, lti } from '../src/services/modules/others.js';
import { HANDLERS } from '../src/services/modules/index.js';
import { fakeCtx } from './helpers.js';

const cm = (modname) => ({ id: 50, course: 9, instance: 500, modname });

test('board reads configuration, columns, notes and their comments through AJAX', async () => {
  const ctx = fakeCtx({ web: {
    mod_board_get_configuration: { settings: JSON.stringify({ board: { id: '828', name: 'Tabella', intro: '<p>Completa la tabella</p>' } }) },
    mod_board_get_board: [{ id: 3580, name: 'Aspetti', locked: false, notes: [
      { id: 12941, userid: 80590, heading: 'Aspetti - S. L.', content: '<p>Adulti temono questa età</p>', url: null, timecreated: 1791395156, commentcount: 1 },
      { id: 12943, userid: 80591, heading: null, content: '<p>Competenza digitale</p>', url: 'https://example.org/v', timecreated: 1791795443, commentcount: 0 },
    ] }],
    mod_board_get_comments: { comments: [{ id: 1, content: 'Bello!', timecreated: 1791795443 }] },
  } });
  const out = await board(ctx, { id: 50, course: 9, instance: 828, modname: 'board' });
  assert.equal(out.intro, 'Completa la tabella');
  assert.deepEqual(out.columns, [{ id: 3580, name: 'Aspetti', notes: [
    { id: 12941, heading: 'Aspetti - S. L.', text: 'Adulti temono questa età', date: '2026-10-07T17:45:56.000Z', comments: [{ text: 'Bello!', date: '2026-10-12T08:57:23.000Z' }] },
    { id: 12943, text: 'Competenza digitale', url: 'https://example.org/v', date: '2026-10-12T08:57:23.000Z' },
  ] }]);
  assert.deepEqual(ctx.calls.filter((c) => c.fn === 'mod_board_get_comments').map((c) => c.args), [{ noteid: 12941 }]);
  assert.ok(ctx.calls.every((c) => c.kind === 'web'));
  assert.equal(JSON.stringify(out).includes('80590'), false); // note authors are never exposed
});

test('glossary lists its entries', async () => {
  const ctx = fakeCtx({ ws: {
    mod_glossary_get_glossaries_by_courses: { glossaries: [{ id: 500, coursemodule: 50, intro: '<p>Inserisci la parola</p>', introfiles: [] }] },
    mod_glossary_get_entries_by_letter: { count: 1, entries: [{ concept: 'Ambito di competenze', userfullname: 'B. C.', timecreated: 1791395156, definition: '<p>Insieme di</p>', attachments: [] }] },
  } });
  assert.deepEqual(await glossary(ctx, cm('glossary')), { intro: 'Inserisci la parola', count: 1, entries: [{ concept: 'Ambito di competenze', author: 'B. C.', date: '2026-10-07T17:45:56.000Z', text: 'Insieme di' }] });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_glossary_get_entries_by_letter').args, { id: 500, letter: 'ALL', from: 0, limit: 500 });
});

test('feedback shows questions, options and whether I answered', async () => {
  const ctx = fakeCtx({ ws: {
    mod_feedback_get_feedbacks_by_courses: { feedbacks: [{ id: 500, coursemodule: 50, intro: '', introfiles: [], anonymous: 1, timeopen: 0, timeclose: 0 }] },
    mod_feedback_get_feedback_access_information: { isopen: true, isalreadysubmitted: false },
    mod_feedback_get_items: { items: [
      { typ: 'label', name: '', presentation: '<p>Leggi il caso</p>', itemnumber: null, required: false },
      { typ: 'multichoice', name: "L'atteggiamento è comprensibile?", presentation: 'c>>>>>SÌ\r|NO', itemnumber: 1, required: true },
      { typ: 'pagebreak', name: '', presentation: '' },
      { typ: 'textarea', name: 'Perché?', presentation: '30|5', itemnumber: 2, required: false },
    ] },
  } });
  assert.deepEqual(await feedback(ctx, cm('feedback')), {
    anonymous: true, open: true, submitted: false,
    questions: [
      { type: 'label', question: 'Leggi il caso' },
      { number: 1, type: 'multichoice', question: "L'atteggiamento è comprensibile?", required: true, options: ['SÌ', 'NO'] },
      { number: 2, type: 'textarea', question: 'Perché?' },
    ],
  });
});

test('choicegroup shows the groups and my choice', async () => {
  const ctx = fakeCtx({ ws: { mod_choicegroup_get_choicegroup_options: { options: [
    { id: 1, name: 'Group A', countanswers: 22, maxanswers: 0, checked: true, disabled: false },
    { id: 2, name: 'Group B', countanswers: 20, maxanswers: 25, checked: false, disabled: false },
  ] } } });
  assert.deepEqual(await choicegroup(ctx, cm('choicegroup')), { options: [{ name: 'Group A', members: 22, chosen: true }, { name: 'Group B', members: 20, max: 25 }] });
  assert.deepEqual(ctx.calls[0].args, { choicegroupid: 500, userid: 7 });
});

test('choice shows options, votes and my answer', async () => {
  const ctx = fakeCtx({ ws: {
    mod_choice_get_choices_by_courses: { choices: [{ id: 500, coursemodule: 50, intro: '<p>Scegli</p>', introfiles: [], timeopen: 0, timeclose: 1794178740 }] },
    mod_choice_get_choice_options: { options: [{ id: 1, text: 'Lunedì', checked: true, maxanswers: 0 }, { id: 2, text: 'Martedì', checked: false, maxanswers: 10 }] },
    mod_choice_get_choice_results: { options: [{ id: 1, numberofuser: 4 }, { id: 2, numberofuser: 6 }] },
  } });
  assert.deepEqual(await choice(ctx, cm('choice')), { intro: 'Scegli', closes: '2026-11-08T22:59:00.000Z', options: [{ text: 'Lunedì', chosen: true, votes: 4 }, { text: 'Martedì', votes: 6, max: 10 }] });
});

test('wiki reads the pages of every subwiki', async () => {
  const ctx = fakeCtx({ ws: {
    mod_wiki_get_wikis_by_courses: { wikis: [{ id: 500, coursemodule: 50, intro: '', introfiles: [] }] },
    mod_wiki_get_subwikis: { subwikis: [{ id: 1, groupid: 0, userid: 0 }] },
    mod_wiki_get_subwiki_pages: { pages: [{ id: 11, title: 'Home', timemodified: 1791395156 }] },
    mod_wiki_get_page_contents: { page: { id: 11, title: 'Home', cachedcontent: '<p>Benvenuti nel wiki</p>' } },
  } });
  assert.deepEqual(await wiki(ctx, cm('wiki')), { pages: [{ title: 'Home', modified: '2026-10-07T17:45:56.000Z', text: 'Benvenuti nel wiki' }] });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_wiki_get_subwiki_pages').args, { wikiid: 500, groupid: 0, userid: 0 });
});

test('data lists entries with field names', async () => {
  const ctx = fakeCtx({ ws: {
    mod_data_get_databases_by_courses: { databases: [{ id: 500, coursemodule: 50, intro: '', introfiles: [] }] },
    mod_data_get_fields: { fields: [{ id: 1, name: 'Titolo' }, { id: 2, name: 'Link' }] },
    mod_data_get_entries: { totalcount: 1, entries: [{ id: 9, fullname: 'A. B.', timecreated: 1791395156, contents: [{ fieldid: 1, content: 'Libro' }, { fieldid: 2, content: 'https://example.org' }] }] },
  } });
  assert.deepEqual(await data(ctx, cm('data')), { total: 1, entries: [{ author: 'A. B.', date: '2026-10-07T17:45:56.000Z', fields: { Titolo: 'Libro', Link: 'https://example.org' } }] });
});

test('lesson shows access, attempts and grade', async () => {
  const ctx = fakeCtx({ ws: {
    mod_lesson_get_lessons_by_courses: { lessons: [{ id: 500, coursemodule: 50, intro: '', introfiles: [], available: 0, deadline: 1794178740, timelimit: 0 }] },
    mod_lesson_get_lesson_access_information: { attemptscount: 2, preventaccessreasons: [{ reason: 'x', message: 'Password required' }] },
    mod_lesson_get_user_grade: { grade: 80, formattedgrade: '80.00' },
  } });
  assert.deepEqual(await lesson(ctx, cm('lesson')), { closes: '2026-11-08T22:59:00.000Z', attempts: 2, blocked: ['Password required'], grade: '80.00' });
});

test('scorm shows attempts and launchable items', async () => {
  const ctx = fakeCtx({ ws: {
    mod_scorm_get_scorms_by_courses: { scorms: [{ id: 500, coursemodule: 50, intro: '', introfiles: [], timeopen: 0, timeclose: 0, maxattempt: 3 }] },
    mod_scorm_get_scorm_attempt_count: { attemptscount: 1 },
    mod_scorm_get_scorm_scoes: { scoes: [{ title: 'Pacchetto', launch: '' }, { title: 'Modulo 1', launch: 'index.html' }] },
  } });
  assert.deepEqual(await scorm(ctx, cm('scorm')), { maxAttempts: 3, attempts: 1, items: ['Modulo 1'] });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_scorm_get_scorm_attempt_count').args, { scormid: 500, userid: 7 });
});

test('workshop shows phases, tasks and grades', async () => {
  const ctx = fakeCtx({ ws: {
    mod_workshop_get_workshops_by_courses: { workshops: [{ id: 500, coursemodule: 50, intro: '', introfiles: [] }] },
    mod_workshop_get_user_plan: { userplan: { phases: [
      { title: 'Submission phase', active: true, tasks: [{ title: 'Submit your work', completed: '1' }, { title: 'Read the brief', completed: '' }] },
      { title: 'Assessment phase', active: false, tasks: [] },
    ] } },
    mod_workshop_get_grades: { submissionlongstrgrade: '75.00 / 80.00', assessmentlongstrgrade: '18.00 / 20.00' },
  } });
  assert.deepEqual(await workshop(ctx, cm('workshop')), {
    phases: [{ title: 'Submission phase', active: true, tasks: [{ title: 'Submit your work', done: true }, { title: 'Read the brief' }] }, { title: 'Assessment phase' }],
    submissionGrade: '75.00 / 80.00',
    assessmentGrade: '18.00 / 20.00',
  });
});

test('h5pactivity lists my attempts', async () => {
  const ctx = fakeCtx({ ws: {
    mod_h5pactivity_get_h5pactivities_by_courses: { h5pactivities: [{ id: 500, coursemodule: 50, intro: '', introfiles: [] }] },
    mod_h5pactivity_get_attempts: { usersattempts: [{ userid: 7, attempts: [{ attempt: 1, timecreated: 1791395156, rawscore: 4, maxscore: 5, success: 1, duration: 120 }] }] },
  } });
  assert.deepEqual(await h5pactivity(ctx, cm('h5pactivity')), { attempts: [{ number: 1, date: '2026-10-07T17:45:56.000Z', score: '4/5', success: 1, duration: 120 }] });
});

test('bigbluebuttonbn shows times and recordings', async () => {
  const rows = [{ name: '<span>Lezione 1</span>', description: '', date: 1791395156000, playback: '<a href="https://www.icorsi.ch/mod/bigbluebuttonbn/bbb_view.php?action=play&id=1">Presentation</a>' }];
  const ctx = fakeCtx({ ws: {
    mod_bigbluebuttonbn_get_bigbluebuttonbns_by_courses: { bigbluebuttonbns: [{ id: 500, coursemodule: 50, intro: '', introfiles: [], openingtime: 1791395156, closingtime: 0 }] },
    mod_bigbluebuttonbn_get_recordings: { status: true, tabledata: { data: JSON.stringify(rows) } },
  } });
  assert.deepEqual(await bigbluebuttonbn(ctx, cm('bigbluebuttonbn')), {
    opens: '2026-10-07T17:45:56.000Z',
    recordings: [{ name: 'Lezione 1', date: '2026-10-07T17:45:56.000Z', links: [{ name: 'Presentation', url: 'https://www.icorsi.ch/mod/bigbluebuttonbn/bbb_view.php?action=play&id=1' }] }],
  });
});

test('lti only describes the external tool', async () => {
  const ctx = fakeCtx({ ws: { mod_lti_get_ltis_by_courses: { ltis: [{ id: 500, coursemodule: 50, intro: '<p>Strumento</p>', introfiles: [] }] } } });
  assert.deepEqual(await lti(ctx, cm('lti')), { intro: 'Strumento', note: 'External tool: it opens only in a browser' });
});

test('the registry covers every readable activity type', () => {
  assert.deepEqual(Object.keys(HANDLERS).sort(), [
    'assign', 'bigbluebuttonbn', 'board', 'book', 'choice', 'choicegroup', 'data', 'feedback', 'folder', 'forum', 'glossary', 'h5pactivity',
    'imscp', 'label', 'lesson', 'lti', 'page', 'quiz', 'resource', 'scorm', 'url', 'wiki', 'workshop',
  ]);
});
