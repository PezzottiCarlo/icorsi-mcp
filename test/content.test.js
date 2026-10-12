import test from 'node:test';
import assert from 'node:assert/strict';
import { page, book, label, resource, folder, url } from '../src/services/modules/content.js';
import { fakeCtx } from './helpers.js';

const cm = (id, modname) => ({ id, course: 9, modname, instance: id + 1000, name: 'x' });

test('page returns its text, linked files and external links', async () => {
  const ctx = fakeCtx({ ws: { mod_page_get_pages_by_courses: { pages: [{ id: 1, coursemodule: 1, intro: '', introfiles: [], timemodified: 1791795443,
    content: '<p>Obiettivi</p><p><a href="https://www.icorsi.ch/webservice/pluginfile.php/3/mod_page/content/1/scheda.pdf">Scheda</a> <a href="https://example.org">Sito</a></p><img src="https://www.icorsi.ch/webservice/pluginfile.php/3/mod_page/content/1/foto.png">',
    contentfiles: [
      { filename: 'foto.png', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/3/mod_page/content/1/foto.png', mimetype: 'image/png' },
      { filename: 'extra.docx', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/3/mod_page/content/1/extra.docx', mimetype: 'application/msword' },
    ] }] } } });
  const out = await page(ctx, cm(1, 'page'));
  assert.equal(out.text, 'Obiettivi\nScheda Sito');
  assert.deepEqual(out.files.map((f) => f.name), ['Scheda', 'extra.docx']);
  assert.deepEqual(out.links, [{ name: 'Sito', url: 'https://example.org' }]);
  assert.equal(out.modified, '2026-10-12T08:57:23.000Z');
});

test('book reads every chapter in table-of-contents order', async () => {
  const chapter = (id) => `https://www.icorsi.ch/webservice/pluginfile.php/2/mod_book/chapter/${id}/index.html`;
  const contents = [
    { type: 'content', filename: 'structure', content: JSON.stringify([
      { title: 'Video introduttivo', href: '30069/index.html', level: 0, hidden: '0', subitems: [{ title: 'Sotto', href: '30071/index.html', level: 1, hidden: '0', subitems: [] }] },
      { title: 'Quaderno', href: '30070/index.html', level: 0, hidden: '1', subitems: [] },
    ]) },
    { type: 'file', filename: 'index.html', filepath: '/30069/', fileurl: chapter(30069) },
    { type: 'file', filename: 'index.html', filepath: '/30070/', fileurl: chapter(30070) },
    { type: 'file', filename: 'index.html', filepath: '/30071/', fileurl: chapter(30071) },
  ];
  const ctx = fakeCtx({ files: {
    [chapter(30069)]: '<p>Guarda il video</p><iframe src="https://www.youtube.com/embed/v"></iframe>',
    [chapter(30070)]: '<p>Quaderno</p>',
    [chapter(30071)]: '<p>Dettaglio</p>',
  } });
  const { chapters } = await book(ctx, cm(7, 'book'), { contents });
  assert.deepEqual(chapters.map((c) => [c.id, c.title, c.level, c.hidden, c.text]), [
    [30069, 'Video introduttivo', undefined, undefined, 'Guarda il video'],
    [30071, 'Sotto', 1, undefined, 'Dettaglio'],
    [30070, 'Quaderno', undefined, true, 'Quaderno'],
  ]);
  assert.deepEqual(chapters[0].links, [{ name: 'https://www.youtube.com/embed/v', url: 'https://www.youtube.com/embed/v' }]);
  assert.equal(chapters[0].url, 'https://www.icorsi.ch/mod/book/view.php?id=7&chapterid=30069');
});

test('label, resource and folder', async () => {
  const ctx = fakeCtx();
  assert.deepEqual(await label(ctx, cm(1, 'label'), { description: '<p>Consegna <a href="https://example.org/d">doc</a></p>' }), { text: 'Consegna doc', links: [{ name: 'doc', url: 'https://example.org/d' }] });
  const contents = [
    { type: 'file', filename: 'a.pdf', filepath: '/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_folder/content/1/a.pdf' },
    { type: 'file', filename: 'b.pdf', filepath: '/sub/', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_folder/content/1/sub/b.pdf' },
  ];
  assert.deepEqual((await resource(ctx, cm(2, 'resource'), { contents })).files.map((f) => f.name), ['a.pdf', 'b.pdf']);
  const f = await folder(ctx, cm(3, 'folder'), { contents });
  assert.equal(f.files[1].folder, '/sub/');
  assert.equal(f.zip, 'https://www.icorsi.ch/mod/folder/download_folder.php?id=3');
});

test('url reads the target and the posts of a Padlet wall', async () => {
  const target = { contents: [{ type: 'url', fileurl: 'https://padlet.com/a/b' }] };
  const ctx = fakeCtx({ padlet: { getWall: async (u) => ({ url: u, title: 'Wall', posts: [{ id: 1 }] }) } });
  assert.deepEqual(await url(ctx, cm(4, 'url'), target), { target: 'https://padlet.com/a/b', padlet: { url: 'https://padlet.com/a/b', title: 'Wall', posts: [{ id: 1 }] } });
  const failing = fakeCtx({ padlet: { getWall: async () => { throw new Error('private wall'); } } });
  assert.deepEqual(await url(failing, cm(4, 'url'), target), { target: 'https://padlet.com/a/b', padletError: 'private wall' });
  const viaInstance = fakeCtx({ ws: { mod_url_get_urls_by_courses: { urls: [{ coursemodule: 4, externalurl: 'https://example.org' }] } } });
  assert.deepEqual(await url(viaInstance, cm(4, 'url'), null), { target: 'https://example.org' });
});
