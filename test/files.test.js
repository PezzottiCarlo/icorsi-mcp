import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { download, dispositionName, safeName } from '../src/services/files.js';
import { fakeCtx } from './helpers.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'icorsi-dl-'));
const pdf = () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } });
const resource = (contents) => ({
  core_course_get_course_module: { cm: { id: 50, course: 9, modname: 'resource', instance: 1, name: 'A' } },
  core_course_get_contents: [{ id: 1, name: 'S', modules: [{ id: 50, modname: 'resource', name: 'A', contents }] }],
});

test('dispositionName and safeName', () => {
  assert.equal(dispositionName("attachment; filename*=UTF-8''L1%20%C3%A8.zip"), 'L1 è.zip');
  assert.equal(dispositionName('attachment; filename="L1 Ã¨.zip"'), 'L1 è.zip');
  assert.equal(dispositionName(null), null);
  assert.equal(safeName('a/b:c?.pdf'), 'a_b_c_.pdf');
});

test('download saves a pluginfile through the web service', async () => {
  const url = 'https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/Il%20salmone.pdf';
  const dir = tmpDir();
  const r = await download(fakeCtx({ fileResponses: { [url]: pdf } }), url, { dir });
  assert.deepEqual(r, { path: path.join(dir, 'Il salmone.pdf'), name: 'Il salmone.pdf', mimeType: 'application/pdf', size: 8 });
  assert.equal(fs.readFileSync(r.path, 'utf8'), '%PDF-1.4');
});

test('download of a File activity fetches its only file', async () => {
  const ctx = fakeCtx({
    ws: resource([{ type: 'file', filename: 'a.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/mod_resource/content/1/a.pdf' }]),
    fileResponses: { 'https://www.icorsi.ch/pluginfile.php/1/mod_resource/content/1/a.pdf': pdf },
  });
  assert.equal((await download(ctx, 'https://www.icorsi.ch/mod/resource/view.php?id=50', { dir: tmpDir() })).name, 'a.pdf');
});

test('download of a folder activity gets the zip through the website', async () => {
  const zip = 'https://www.icorsi.ch/mod/folder/download_folder.php?id=60';
  const ctx = fakeCtx({
    ws: {
      core_course_get_course_module: { cm: { id: 60, course: 9, modname: 'folder', instance: 1, name: 'L1' } },
      core_course_get_contents: [{ id: 1, name: 'S', modules: [{ id: 60, modname: 'folder', name: 'L1', contents: [] }] }],
    },
    fileResponses: { [zip]: () => new Response('PK', { headers: { 'content-type': 'application/zip', 'content-disposition': "attachment; filename*=UTF-8''L1.zip" } }) },
  });
  assert.equal((await download(ctx, 'https://www.icorsi.ch/mod/folder/view.php?id=60', { dir: tmpDir() })).name, 'L1.zip');
});

test('download refuses other sites, web pages and multi-file activities', async () => {
  await assert.rejects(download(fakeCtx(), 'https://example.org/a.pdf'), /www\.icorsi\.ch/);
  const page = 'https://www.icorsi.ch/mod/folder/download_folder.php?id=1';
  const html = fakeCtx({ fileResponses: { [page]: () => new Response('<html>', { headers: { 'content-type': 'text/html' } }) } });
  await assert.rejects(download(html, page, { dir: tmpDir() }), /web page/);
  const two = fakeCtx({ ws: resource([
    { type: 'file', filename: 'a.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/a.pdf' },
    { type: 'file', filename: 'b.pdf', fileurl: 'https://www.icorsi.ch/webservice/pluginfile.php/1/b.pdf' },
  ]) });
  await assert.rejects(download(two, 'https://www.icorsi.ch/mod/resource/view.php?id=50'), /2 files/);
});
