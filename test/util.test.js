import test from 'node:test';
import assert from 'node:assert/strict';
import { decode, clean, toIso, compact } from '../src/util/text.js';
import { isFileUrl, publicFileUrl, fileKey, fileNameFromUrl, cmidFromUrl, discussionIdFromUrl } from '../src/util/url.js';
import { htmlToText, htmlLinks } from '../src/util/html.js';
import { pool } from '../src/util/pool.js';
import { Memo } from '../src/util/memo.js';
import { IcorsiError, TokenInvalid } from '../src/errors.js';

test('decode turns HTML entities into characters', () => {
  assert.equal(decode('dell&#39;educazione &amp; &quot;x&quot; &#x41; &ndash;'), 'dell\'educazione & "x" A –');
  assert.equal(decode(null), null);
  assert.equal(decode(undefined), undefined);
});

test('clean collapses whitespace', () => {
  assert.equal(clean('  a \n\t b  '), 'a b');
  assert.equal(clean(null), '');
});

test('toIso maps unix seconds and treats 0 as unset', () => {
  assert.equal(toIso(0), null);
  assert.equal(toIso(null), null);
  assert.equal(toIso(1791795443), '2026-10-12T08:57:23.000Z');
});

test('compact drops empty fields but keeps false and 0', () => {
  assert.deepEqual(compact({ a: 1, b: null, c: undefined, d: '', e: [], f: false, g: 0 }), { a: 1, f: false, g: 0 });
});

test('file URLs are normalised to the browser form', () => {
  const ws = 'https://www.icorsi.ch/webservice/pluginfile.php/9/mod_folder/content/5/x.pdf?forcedownload=1&token=abc';
  assert.equal(isFileUrl(ws), true);
  assert.equal(isFileUrl('https://www.icorsi.ch/mod/page/view.php?id=1'), false);
  assert.equal(publicFileUrl(ws), 'https://www.icorsi.ch/pluginfile.php/9/mod_folder/content/5/x.pdf');
  assert.equal(fileKey('https://www.icorsi.ch/pluginfile.php/9/mod_folder/content/5/x.pdf?forcedownload=1'), fileKey(ws));
  assert.equal(fileNameFromUrl('https://www.icorsi.ch/pluginfile.php/1/a/b/Il%20salmone.pdf'), 'Il salmone.pdf');
});

test('folder files keep one key whatever the folder revision in the URL', () => {
  // v1 indexed the folder page links (itemid 0); the web service puts the folder revision there
  assert.equal(
    fileKey('https://www.icorsi.ch/webservice/pluginfile.php/2160300/mod_folder/content/5/Lezione%201.pdf?forcedownload=1'),
    'https://www.icorsi.ch/pluginfile.php/2160300/mod_folder/content/0/Lezione%201.pdf',
  );
  assert.equal(fileKey('https://www.icorsi.ch/pluginfile.php/9/mod_resource/content/3/a.pdf'), 'https://www.icorsi.ch/pluginfile.php/9/mod_resource/content/3/a.pdf');
});

test('activity and discussion ids come out of iCorsi URLs only', () => {
  assert.equal(cmidFromUrl('https://www.icorsi.ch/mod/forum/view.php?id=1389466'), 1389466);
  assert.equal(cmidFromUrl('https://www.icorsi.ch/course/view.php?id=5'), null);
  assert.equal(cmidFromUrl('https://evil.example/mod/page/view.php?id=1'), null);
  assert.equal(discussionIdFromUrl('https://www.icorsi.ch/mod/forum/discuss.php?d=155947#p240737'), 155947);
  assert.equal(discussionIdFromUrl('https://www.icorsi.ch/mod/forum/view.php?id=1'), null);
});

test('htmlToText keeps paragraph breaks and drops scripts', () => {
  assert.equal(htmlToText('<p>Ciao <b>mondo</b></p><p>riga&nbsp;2</p>'), 'Ciao mondo\nriga 2');
  assert.equal(htmlToText('<script>x</script><div>a<br>b</div>'), 'a\nb');
  assert.equal(htmlToText('<ul><li>uno</li><li>due</li></ul>'), 'uno\ndue');
  assert.equal(htmlToText('<table><tr><td>a</td><td>b</td></tr></table>'), 'a b');
  assert.equal(htmlToText('<p>Care studentesse,</p>\r\n<p>come comunicato</p>'), 'Care studentesse,\n\ncome comunicato');
  assert.equal(htmlToText('<p>abcdef</p>', { max: 3 }), 'abc');
  assert.equal(htmlToText('<div class="flag">Flag</div><p>Q</p>', { remove: '.flag' }), 'Q');
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

test('htmlLinks separates external links from iCorsi files', () => {
  const html = '<a href="https://example.org/x">Ex</a>'
    + '<a href="https://www.icorsi.ch/webservice/pluginfile.php/1/mod_page/content/2/a%20b.pdf?forcedownload=1">Doc</a>'
    + '<a href="https://www.icorsi.ch/course/view.php?id=1">course</a>'
    + '<iframe src="https://www.youtube.com/embed/abc"></iframe>';
  assert.deepEqual(htmlLinks(html), {
    links: [
      { name: 'Ex', url: 'https://example.org/x' },
      { name: 'https://www.youtube.com/embed/abc', url: 'https://www.youtube.com/embed/abc' },
    ],
    files: [{ name: 'Doc', url: 'https://www.icorsi.ch/pluginfile.php/1/mod_page/content/2/a%20b.pdf' }],
  });
  assert.deepEqual(htmlLinks(html, { internal: true }).links.map((l) => l.name), ['Ex', 'course', 'https://www.youtube.com/embed/abc']);
  assert.deepEqual(htmlLinks(null), { links: [], files: [] });
});

test('pool keeps the input order with limited concurrency', async () => {
  let running = 0;
  let peak = 0;
  const out = await pool([30, 10, 20, 5], 2, async (ms, i) => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, ms));
    running--;
    return i;
  });
  assert.deepEqual(out, [0, 1, 2, 3]);
  assert.equal(peak, 2);
  assert.deepEqual(await pool([], 3, async () => 1), []);
});

test('Memo caches within the TTL and forgets failures', async () => {
  let clock = 0;
  const memo = new Memo(1000, () => clock);
  let calls = 0;
  const fn = async () => ++calls;
  assert.equal(await memo.get('k', fn), 1);
  assert.equal(await memo.get('k', fn), 1);
  clock = 1001;
  assert.equal(await memo.get('k', fn), 2);
  await assert.rejects(memo.get('bad', async () => { throw new Error('boom'); }));
  assert.equal(await memo.get('bad', async () => 'ok'), 'ok');
});

test('errors carry a code and a name', () => {
  const e = new TokenInvalid('x', { code: 'invalidtoken' });
  assert.ok(e instanceof IcorsiError);
  assert.equal(e.name, 'TokenInvalid');
  assert.equal(e.code, 'invalidtoken');
});
