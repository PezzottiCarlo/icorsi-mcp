import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { contentItems, findNewContent } from '../src/services/updates.js';
import { loadIndex, saveIndex, mergeScan, INDEX_VERSION } from '../src/store/index-store.js';
import { searchIndex } from '../src/services/search.js';
import { fakeCtx } from './helpers.js';

const tmpIndex = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icorsi-index-')), 'index.json');

const SECTIONS = [{ id: 1, name: 'Lezione 1', summary: '', modules: [
  { id: 50, name: 'Slide', modname: 'resource', url: 'https://www.icorsi.ch/mod/resource/view.php?id=50', uservisible: true,
    contents: [{ type: 'file', filename: 'slide.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_resource/content/1/slide.pdf?forcedownload=1', timemodified: 1791795443 }] },
  { id: 51, name: 'Consegne', modname: 'label', uservisible: true, description: '<p>Guardate <a href="https://www.youtube.com/watch?v=x">il video</a></p>' },
  { id: 52, name: 'Annunci', modname: 'forum', url: 'https://www.icorsi.ch/mod/forum/view.php?id=52', uservisible: true },
  { id: 53, name: 'Obiettivi', modname: 'page', url: 'https://www.icorsi.ch/mod/page/view.php?id=53', uservisible: true },
] }];

const WELCOME = { id: 70, subject: 'Benvenuti', message: '<p>Ciao a tutti</p>', author: { fullname: 'Paolo Arru' }, discussionid: 7, timecreated: 1791395156, timemodified: 1791395156, attachments: [] };

const scanCtx = ({
  discussions = [{ discussion: 7, name: 'Benvenuti', userfullname: 'Paolo Arru', created: 1791395156, timemodified: 1791395156 }],
  posts = { 7: [WELCOME] },
  updates = { instances: [] },
  assignments = { courses: [] },
} = {}) => fakeCtx({ ws: {
  core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 9, fullname: 'Pedagogia', viewurl: 'https://www.icorsi.ch/course/view.php?id=9' }] },
  core_course_get_contents: SECTIONS,
  mod_forum_get_forums_by_courses: [{ id: 1, cmid: 52, course: 9, name: 'Annunci' }],
  mod_page_get_pages_by_courses: { pages: [{ coursemodule: 53, content: '<p>Descrivere i comportamenti</p>' }] },
  mod_forum_get_forum_discussions: { discussions },
  mod_forum_get_discussion_posts: ({ discussionid }) => ({ posts: posts[discussionid] ?? [] }),
  core_course_get_updates_since: updates,
  mod_assign_get_assignments: assignments,
} });

test('contentItems lists activities, files, links and page text', () => {
  const items = contentItems(SECTIONS, new Map([[53, { content: '<p>Descrivere i comportamenti</p>' }]]));
  assert.deepEqual(Object.keys(items).sort(), [
    'activity:50', 'activity:51', 'activity:52', 'activity:53',
    'file:https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/slide.pdf',
    'link:https://www.youtube.com/watch?v=x',
  ]);
  assert.equal(items['activity:53'].text, 'Descrivere i comportamenti');
  assert.equal(items['activity:51'].text, 'Guardate il video');
  assert.equal(items['file:https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/slide.pdf'].path, 'Lezione 1 > Slide');
});

test('contentItems does not list a page own index.html as a file', () => {
  const page = { id: 60, name: 'Obiettivi', modname: 'page', url: 'https://www.icorsi.ch/mod/page/view.php?id=60', uservisible: true, contents: [
    { type: 'file', filename: 'index.html', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/5/mod_page/content/index.html' },
    { type: 'file', filename: 'foto.png', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/5/mod_page/content/3/foto.png' },
  ] };
  const html = '<p>Vedi <a href="https://www.icorsi.ch/webservice/pluginfile.php/5/mod_page/content/3/scheda.pdf">la scheda</a></p>';
  const items = contentItems([{ id: 1, name: 'S', modules: [page] }], new Map([[60, { content: html }]]));
  assert.deepEqual(Object.keys(items).filter((k) => k.startsWith('file:')), ['file:https://www.icorsi.ch/pluginfile.php/5/mod_page/content/3/scheda.pdf']);
});

test('the scan indexes the files and links of assignment instructions', async () => {
  const file = tmpIndex();
  const assignments = { courses: [{ id: 9, assignments: [{ cmid: 50, name: 'Consegna', intro: '<p>Leggi <a href="https://example.org/guida">la guida</a></p>', introfiles: [],
    introattachments: [{ filename: 'traccia.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/3/mod_assign/introattachment/0/traccia.pdf' }] }] }] };
  await findNewContent(scanCtx({ assignments }), { indexFile: file });
  const items = loadIndex(file).courses[9].items;
  assert.equal(items['file:https://www.icorsi.ch/pluginfile.php/3/mod_assign/introattachment/0/traccia.pdf'].path, 'Lezione 1 > Slide');
  assert.equal(items['link:50:https://example.org/guida'].kind, 'link');
});

test('mergeScan records a baseline, then reports only new items', () => {
  const index = { courses: {} };
  const course = { id: 9, fullname: 'Pedagogia', url: 'u' };
  assert.deepEqual(mergeScan(index, course, { a: { kind: 'activity', name: 'A' } }, { now: 1 }), { baseline: true, fresh: [] });
  assert.deepEqual(mergeScan(index, course, { a: { kind: 'activity', name: 'A' }, b: { kind: 'file', name: 'B' } }, { now: 2, stamps: { 7: 100 } }), { baseline: false, fresh: [{ kind: 'file', name: 'B' }] });
  assert.equal(index.courses[9].items.b.firstSeen, 2);
  assert.deepEqual(index.courses[9].discussions, { 7: 100 });
});

test('loadIndex / saveIndex round-trip with a version', () => {
  const file = tmpIndex();
  assert.deepEqual(loadIndex(file), { version: INDEX_VERSION, courses: {} });
  saveIndex({ courses: { 9: { items: {} } } }, file);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, INDEX_VERSION);
  assert.deepEqual(loadIndex(file).courses, { 9: { items: {} } });
});

test('findNewContent: baseline first, then new posts, fetching only changed discussions', async () => {
  const file = tmpIndex();
  const [first] = await findNewContent(scanCtx(), { indexFile: file });
  assert.equal(first.baseline, true);
  assert.deepEqual(first.newItems, []);

  const busy = [
    { discussion: 7, name: 'Benvenuti', created: 1791395156, timemodified: 1791795443 },
    { discussion: 8, name: 'Nuova', created: 1791795443, timemodified: 1791795443 },
  ];
  const reply = { id: 71, subject: 'Re: Benvenuti', message: '<p>Grazie</p>', author: { fullname: 'Test Student' }, discussionid: 7, timecreated: 1791795443, timemodified: 1791795443, attachments: [] };
  const [second] = await findNewContent(scanCtx({ discussions: busy, posts: { 7: [WELCOME, reply], 8: [] } }), { indexFile: file });
  assert.equal(second.baseline, false);
  assert.deepEqual(second.newItems.map((i) => `${i.kind}:${i.name}`).sort(), ['discussion:Nuova', 'post:Re: Benvenuti']);

  const quiet = scanCtx({ discussions: busy });
  const [third] = await findNewContent(quiet, { indexFile: file });
  assert.deepEqual(third.newItems, []);
  assert.equal(quiet.calls.filter((c) => c.fn === 'mod_forum_get_discussion_posts').length, 0);
});

test('findNewContent with markSeen false leaves the index untouched', async () => {
  const file = tmpIndex();
  await findNewContent(scanCtx(), { indexFile: file, markSeen: false });
  assert.equal(fs.existsSync(file), false);
});

test('findNewContent keeps a v1 index compatible', async () => {
  const file = tmpIndex();
  fs.writeFileSync(file, JSON.stringify({ courses: { 9: { name: 'Pedagogia', scannedAt: 1, items: {
    'activity:50': { kind: 'activity' }, 'activity:51': { kind: 'activity' }, 'activity:52': { kind: 'activity' }, 'activity:53': { kind: 'activity' },
    'file:https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/slide.pdf': { kind: 'file' },
    'link:https://www.youtube.com/watch?v=x': { kind: 'link' },
    'discussion:7': { kind: 'discussion' },
    'post:70': { kind: 'post' },
  } } } }));
  const ctx = scanCtx();
  const [r] = await findNewContent(ctx, { indexFile: file });
  assert.equal(r.baseline, false);
  assert.deepEqual(r.newItems, []);
  assert.equal(ctx.calls.filter((c) => c.fn === 'mod_forum_get_discussion_posts').length, 1);
  assert.equal(loadIndex(file).courses[9].discussions[7], 1791395156);
});

test('findNewContent recognises v1 folder file keys (itemid 0) as already seen', async () => {
  const file = tmpIndex();
  const folder = { id: 54, name: 'Lezione 1 materiali', modname: 'folder', url: 'https://www.icorsi.ch/mod/folder/view.php?id=54', uservisible: true,
    contents: [{ type: 'file', filename: 'L1.pdf', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/7/mod_folder/content/5/L1.pdf?forcedownload=1', timemodified: 1791795443 }] };
  fs.writeFileSync(file, JSON.stringify({ courses: { 9: { name: 'Pedagogia', scannedAt: 1, items: {
    'activity:54': { kind: 'activity' },
    'file:https://www.icorsi.ch/pluginfile.php/7/mod_folder/content/0/L1.pdf': { kind: 'file' },
  } } } }));
  const ctx = fakeCtx({ ws: {
    core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 9, fullname: 'Pedagogia' }] },
    core_course_get_contents: [{ id: 1, name: 'Lezione 1', summary: '', modules: [folder] }],
    mod_forum_get_forums_by_courses: [],
    mod_page_get_pages_by_courses: { pages: [] },
    mod_assign_get_assignments: { courses: [] },
  } });
  const [r] = await findNewContent(ctx, { indexFile: file });
  assert.deepEqual(r.newItems, []);
});

test('findNewContent since a date needs no index', async () => {
  const ctx = scanCtx({ updates: { instances: [{ contextlevel: 'module', id: 51, updates: [{ name: 'configuration', timeupdated: 1791795443 }] }] } });
  const [r] = await findNewContent(ctx, { since: '2026-10-10T00:00:00Z' });
  assert.equal(r.since, '2026-10-10T00:00:00.000Z');
  assert.deepEqual(r.newItems.map((i) => `${i.kind}:${i.name}`).sort(), ['activity:Consegne', 'file:slide.pdf']);
  await assert.rejects(findNewContent(ctx, { since: 'yesterday-ish' }), /Invalid date/);
});

test('findNewContent rejects a course the user is not enrolled in', async () => {
  await assert.rejects(findNewContent(scanCtx(), { courseId: 404, indexFile: tmpIndex() }), /Not enrolled in course 404/);
});

test('searchIndex matches every word, accent and case insensitive', () => {
  const index = { courses: { 9: { name: 'Pedagogia', scannedAt: 1791795443000, items: {
    a: { kind: 'file', name: 'Slide Lezione 1.pdf', path: 'Lezione 1 > Slide' },
    b: { kind: 'post', name: 'Domanda', path: 'Forum', text: 'Quando è la verifica?' },
  } } } };
  const r = searchIndex(index, 'VERIFICA quando');
  assert.equal(r.total, 1);
  assert.equal(r.matches[0].name, 'Domanda');
  assert.deepEqual(r.matches[0].course, { id: 9, fullname: 'Pedagogia' });
  assert.equal(r.lastScan, '2026-10-12T08:57:23.000Z');
  assert.equal(searchIndex(index, 'lezione', { kind: 'post' }).total, 0);
  assert.equal(searchIndex({ courses: {} }, 'x').lastScan, null);
});
