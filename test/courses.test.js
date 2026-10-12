import test from 'node:test';
import assert from 'node:assert/strict';
import { slimCourse, slimSections, getCourses, getCourse, searchCourses, getRecentItems, rawContents } from '../src/services/courses.js';
import { mapFiles, completionOf, datesOf, dash, introOf, instanceOf } from '../src/services/common.js';
import { createContext } from '../src/context.js';
import { fakeCtx, fakeStore, jsonResponse } from './helpers.js';

const SECTIONS = [
  { id: 10, name: 'General', section: 0, visible: 1, uservisible: true, summary: '<p>Benvenuti</p>', modules: [
    { id: 100, name: 'Annunci', modname: 'forum', instance: 5, url: 'https://www.icorsi.ch/mod/forum/view.php?id=100', uservisible: true, completiondata: { state: 1 }, dates: [] },
    { id: 101, name: 'Regole &amp; consigli', modname: 'label', instance: 6, description: '<p>Leggete <a href="https://example.org/r">qui</a></p>', uservisible: true },
  ] },
  { id: 11, name: 'Lezione 1', section: 1, visible: 0, uservisible: false, summary: '', modules: [
    { id: 102, name: 'Slide', modname: 'resource', instance: 7, url: 'https://www.icorsi.ch/mod/resource/view.php?id=102', uservisible: true,
      contents: [{ type: 'file', filename: 'slide.pdf', filepath: '/', filesize: 1234, fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_resource/content/1/slide.pdf?forcedownload=1', timemodified: 1791795443, mimetype: 'application/pdf' }],
      dates: [{ label: 'Opened:', timestamp: 1791395156 }] },
    { id: 103, name: 'Video', modname: 'url', instance: 8, url: 'https://www.icorsi.ch/mod/url/view.php?id=103', uservisible: true, contents: [{ type: 'url', filename: 'Video', fileurl: 'https://www.youtube.com/watch?v=x' }] },
  ] },
];

test('common mappers', () => {
  assert.deepEqual(mapFiles(SECTIONS[1].modules[0].contents), [{ name: 'slide.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/slide.pdf', size: 1234, mimetype: 'application/pdf', modified: '2026-10-12T08:57:23.000Z' }]);
  assert.deepEqual(mapFiles([{ type: 'url', fileurl: 'https://x' }]), []);
  assert.equal(completionOf({ completiondata: { state: 0 } }), 'incomplete');
  assert.equal(completionOf({}), undefined);
  assert.deepEqual(datesOf(SECTIONS[1].modules[0]), [{ label: 'Opened:', date: '2026-10-07T17:45:56.000Z' }]);
  assert.equal(dash('-'), null);
  assert.equal(dash('8.50'), '8.50');
  assert.deepEqual(introOf({ intro: '<p>Hi</p>', introfiles: [] }), { intro: 'Hi' });
  assert.deepEqual(introOf(null), {});
});

test('mapFiles reads forum attachments, which carry url instead of fileurl', () => {
  assert.deepEqual(mapFiles([{ filename: 'a.pdf', filepath: '/', url: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_forum/attachment/9/a.pdf', filesize: 5, timemodified: 1791795443 }]), [
    { name: 'a.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_forum/attachment/9/a.pdf', size: 5, modified: '2026-10-12T08:57:23.000Z' },
  ]);
});

test('instanceOf finds the module among the by-courses results and caches per course', async () => {
  const ctx = fakeCtx({ ws: { mod_page_get_pages_by_courses: { pages: [{ id: 1, coursemodule: 50 }, { id: 2, coursemodule: 51 }] } } });
  assert.equal((await instanceOf(ctx, 'mod_page_get_pages_by_courses', 'pages', { id: 51, course: 9 })).id, 2);
  assert.equal(await instanceOf(ctx, 'mod_page_get_pages_by_courses', 'pages', { id: 99, course: 9 }), null);
  assert.equal(ctx.calls.length, 1);
  assert.deepEqual(ctx.calls[0].args, { courseids: [9] });
});

test('slimCourse keeps the useful fields', () => {
  assert.deepEqual(slimCourse({ id: 1, fullname: 'Pedagogia 1 2026/2027', shortname: 'P1', coursecategory: 'Scienze dell&#39;educazione', viewurl: 'https://www.icorsi.ch/course/view.php?id=1', startdate: 1791395156, enddate: 0, hasprogress: false, progress: 0, isfavourite: false, hidden: false }), {
    id: 1, fullname: 'Pedagogia 1 2026/2027', shortname: 'P1', category: "Scienze dell'educazione", url: 'https://www.icorsi.ch/course/view.php?id=1', start: '2026-10-07T17:45:56.000Z',
  });
});

test('slimSections inlines files, links, label text and completion', () => {
  const [general, lesson] = slimSections(SECTIONS);
  assert.equal(general.summary, 'Benvenuti');
  assert.deepEqual(general.activities[0], { id: 100, type: 'forum', name: 'Annunci', url: 'https://www.icorsi.ch/mod/forum/view.php?id=100', completion: 'complete' });
  assert.deepEqual(general.activities[1], { id: 101, type: 'label', name: 'Regole & consigli', text: 'Leggete qui' });
  assert.equal(lesson.hidden, true);
  assert.equal(lesson.activities[0].files[0].name, 'slide.pdf');
  assert.deepEqual(lesson.activities[0].dates, [{ label: 'Opened:', date: '2026-10-07T17:45:56.000Z' }]);
  assert.equal(lesson.activities[1].link, 'https://www.youtube.com/watch?v=x');
});

test('getCourses asks for every enrolled course', async () => {
  const ctx = fakeCtx({ ws: { core_course_get_enrolled_courses_by_timeline_classification: (args) => ({ courses: [{ id: 1, fullname: args.classification, viewurl: 'u' }] }) } });
  assert.deepEqual(await getCourses(ctx, { classification: 'past' }), [{ id: 1, fullname: 'past', url: 'u' }]);
  assert.deepEqual(ctx.calls[0].args, { classification: 'past', limit: 0, offset: 0, sort: 'fullname' });
  assert.equal((await getCourses(ctx))[0].fullname, 'all');
});

test('getCourse merges details and contents', async () => {
  const ctx = fakeCtx({ ws: {
    core_course_get_courses_by_field: { courses: [{ id: 5, fullname: 'Psicologia 1', shortname: 'PSI', categoryname: 'Scienze', summary: '<p>Il corso</p>', contacts: [{ id: 1, fullname: 'Mario Rossi' }], startdate: 1791395156, enddate: 0, format: 'flexsections' }] },
    core_course_get_contents: SECTIONS,
  } });
  const c = await getCourse(ctx, '5');
  assert.equal(c.id, 5);
  assert.deepEqual(c.teachers, ['Mario Rossi']);
  assert.equal(c.summary, 'Il corso');
  assert.equal(c.sections.length, 2);
  assert.equal(c.url, 'https://www.icorsi.ch/course/view.php?id=5');
  await rawContents(ctx, 5);
  assert.equal(ctx.calls.filter((x) => x.fn === 'core_course_get_contents').length, 1); // cached
});

test('searchCourses maps the catalogue results', async () => {
  const ctx = fakeCtx({ ws: { core_course_search_courses: { total: 64, courses: [{ id: 9, fullname: 'Analisi', shortname: 'AN', categoryname: 'Bachelor', summary: '', contacts: [{ fullname: 'Prof X' }], enrollmentmethods: ['manual', 'self'] }] } } });
  assert.deepEqual(await searchCourses(ctx, 'analisi', { page: 1 }), {
    total: 64,
    courses: [{ id: 9, fullname: 'Analisi', shortname: 'AN', category: 'Bachelor', teachers: ['Prof X'], enrolment: ['manual', 'self'], url: 'https://www.icorsi.ch/course/view.php?id=9' }],
  });
  assert.deepEqual(ctx.calls[0].args, { criterianame: 'search', criteriavalue: 'analisi', page: 1, perpage: 20 });
});

test('getRecentItems maps recently opened activities', async () => {
  const ctx = fakeCtx({ ws: { block_recentlyaccesseditems_get_recent_items: [{ cmid: 3, name: 'Quiz &#39;A&#39;', modname: 'quiz', coursename: 'Pedagogia', viewurl: 'https://www.icorsi.ch/mod/quiz/view.php?id=3', timeaccess: 1791795443 }] } });
  assert.deepEqual(await getRecentItems(ctx), [{ id: 3, type: 'quiz', name: "Quiz 'A'", course: 'Pedagogia', url: 'https://www.icorsi.ch/mod/quiz/view.php?id=3', accessed: '2026-10-12T08:57:23.000Z' }]);
  assert.deepEqual(ctx.calls[0].args, { limit: 10 });
});

test('createContext caches the user id', async () => {
  let siteCalls = 0;
  const fetchImpl = async () => { siteCalls++; return jsonResponse({ userid: 42, fullname: 'X' }); };
  const ctx = createContext({ store: fakeStore(), fetchImpl });
  assert.equal(await ctx.userId(), 42);
  assert.equal(await ctx.userId(), 42);
  assert.equal(siteCalls, 1);
});
