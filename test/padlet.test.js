import test from 'node:test';
import assert from 'node:assert/strict';
import { PadletClient, isPadletUrl, wallHashid, mapWish } from '../src/transport/padlet.js';
import { jsonResponse } from './helpers.js';

const PAGE = '<html><head><title>Qualcosa di te (2026)</title>'
  + '<link rel="preload" as="fetch" id="wishes-preload" href="/api/10/wishes?wall_hashid=board_rlV8Am6qVPKRy5NX&amp;page_start=&amp;v=1"></head></html>';
const wish = (id, extra = {}) => ({ id: String(id), type: 'wish', attributes: {
  id, headline: `Post ${id}`, subject: `Post ${id}`, body: '<p>Ciao <b>a tutti</b></p>', attachment: '', attachment_link: null,
  created_at: '2026-09-29T13:09:17.057Z', permalink: `https://padlet.com/x/y/wish/${id}`, ...extra,
} });

test('isPadletUrl and wallHashid', () => {
  assert.equal(isPadletUrl('https://padlet.com/rossanafalcade/qualcosa-di-te'), true);
  assert.equal(isPadletUrl('https://www.icorsi.ch/'), false);
  assert.equal(isPadletUrl('not a url'), false);
  assert.equal(wallHashid(PAGE), 'board_rlV8Am6qVPKRy5NX');
  assert.equal(wallHashid('<html></html>'), null);
});

test('mapWish keeps subject, text, attachment and date', () => {
  assert.deepEqual(mapWish(wish(1, { attachment: 'https://u1.padletusercontent.com/a.jpg' })), {
    id: 1, subject: 'Post 1', text: 'Ciao a tutti', attachment: 'https://u1.padletusercontent.com/a.jpg', date: '2026-09-29T13:09:17.057Z', url: 'https://padlet.com/x/y/wish/1',
  });
  assert.equal(mapWish(wish(2)).attachment, undefined);
});

test('getWall reads the page, then every page of posts', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    seen.push(u.pathname);
    if (u.pathname === '/api/10/wishes') {
      assert.equal(u.searchParams.get('wall_hashid'), 'board_rlV8Am6qVPKRy5NX');
      return u.searchParams.get('page_start')
        ? jsonResponse({ data: [wish(3)], meta: { next: null } })
        : jsonResponse({ data: [wish(1), wish(2)], meta: { next: 'abc' } });
    }
    return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
  };
  const wall = await new PadletClient({ fetchImpl, userAgent: 'UA' }).getWall('https://padlet.com/rossanafalcade/qualcosa');
  assert.equal(wall.title, 'Qualcosa di te (2026)');
  assert.deepEqual(wall.posts.map((p) => p.id), [1, 2, 3]);
  assert.equal(seen.length, 3);
});

test('getWall refuses other hosts and walls without id', async () => {
  const none = new PadletClient({ fetchImpl: async () => new Response('<html></html>') });
  await assert.rejects(none.getWall('https://www.icorsi.ch/x'), /padlet\.com/);
  await assert.rejects(none.getWall('https://padlet.com/a/b'), /wall id/);
});
