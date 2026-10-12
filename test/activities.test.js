import test from 'node:test';
import assert from 'node:assert/strict';
import { getActivity, resolveModule } from '../src/services/activities.js';
import { IcorsiError } from '../src/errors.js';
import { fakeCtx } from './helpers.js';

const base = (modname, mod = {}) => ({
  core_course_get_course_module: { cm: { id: 50, course: 9, modname, instance: 500, name: 'Attività' } },
  core_course_get_contents: [{ id: 1, name: 'Lezione 1', section: 1, modules: [{
    id: 50, name: 'Attività', modname, instance: 500, url: `https://www.icorsi.ch/mod/${modname}/view.php?id=50`,
    description: '<p>Descrizione <a href="https://example.org/x">link</a></p>', completiondata: { state: 0 }, ...mod,
  }] }],
});

test('resolveModule accepts a cmid or an activity URL', async () => {
  const ctx = fakeCtx({ ws: base('page') });
  const r1 = await resolveModule(ctx, { url: 'https://www.icorsi.ch/mod/page/view.php?id=50' });
  assert.equal(r1.cm.id, 50);
  assert.equal(r1.section, 'Lezione 1');
  assert.equal((await resolveModule(ctx, { cmid: 50 })).mod.id, 50);
  assert.equal(ctx.calls.filter((c) => c.fn === 'core_course_get_course_module').length, 1);
  await assert.rejects(resolveModule(ctx, { url: 'https://www.icorsi.ch/course/view.php?id=9' }), IcorsiError);
});

test('getActivity adds description, links and completion to the handler output', async () => {
  const ctx = fakeCtx({ ws: base('resource', { contents: [{ type: 'file', filename: 'a.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf' }] }) });
  assert.deepEqual(await getActivity(ctx, 50), {
    id: 50, type: 'resource', name: 'Attività', course: 9, section: 'Lezione 1', url: 'https://www.icorsi.ch/mod/resource/view.php?id=50',
    description: 'Descrizione link', completion: 'incomplete',
    files: [{ name: 'a.pdf', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/a.pdf' }],
    links: [{ name: 'link', url: 'https://example.org/x' }],
  });
});

test('getActivity gives a note for types iCorsi does not expose', async () => {
  const a = await getActivity(fakeCtx({ ws: base('wooclap') }), { cmid: 50 });
  assert.match(a.note, /wooclap/);
  assert.equal(a.name, 'Attività');
});

test('getActivity keeps base info when the handler throws', async () => {
  const a = await getActivity(fakeCtx({ ws: { ...base('page'), mod_page_get_pages_by_courses: new IcorsiError('No permission') } }), '50');
  assert.equal(a.type, 'page');
  assert.match(a.error, /No permission/);
  assert.equal(a.description, 'Descrizione link');
});

test('getActivity rejects file URLs and non-activity URLs', async () => {
  const ctx = fakeCtx({ ws: base('page') });
  await assert.rejects(getActivity(ctx, 'https://www.icorsi.ch/pluginfile.php/1/a.pdf'), /icorsi_download/);
  await assert.rejects(getActivity(ctx, 'https://www.icorsi.ch/my/'), IcorsiError);
});
