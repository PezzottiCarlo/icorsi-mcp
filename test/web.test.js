import test from 'node:test';
import assert from 'node:assert/strict';
import { WebTransport } from '../src/transport/web.js';
import { SessionExpired, ReadOnlyViolation, IcorsiError } from '../src/errors.js';
import { fakeStore, jsonResponse, tokenUrl } from './helpers.js';

const MY = '<script>M.cfg = {"sesskey":"S1","userId":7};</script>';

// fetch double: handler(url, init, n) -> Response; records every request
function fakeFetch(handler) {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    seen.push({ url: u, init });
    return handler(u, init, seen.length);
  };
  f.seen = seen;
  return f;
}

test('fetch sends the cookies and stores Set-Cookie', async () => {
  const store = fakeStore();
  const fetchImpl = fakeFetch(() => new Response('ok', { headers: [['set-cookie', 'MoodleSession=xyz; path=/; HttpOnly'], ['set-cookie', 'bal35=1; path=/']] }));
  const web = new WebTransport(store, { fetchImpl });
  assert.equal(await (await web.fetch('/my/')).text(), 'ok');
  assert.equal(fetchImpl.seen[0].init.headers.cookie, 'MoodleSession=abc');
  assert.equal(fetchImpl.seen[0].init.headers['user-agent'], 'test-agent');
  assert.deepEqual(store.cookies, { MoodleSession: 'xyz', bal35: '1' });
});

test('fetch refuses other sites and follows same-site redirects', async () => {
  const fetchImpl = fakeFetch((u) => (u.pathname === '/a' ? new Response(null, { status: 303, headers: { location: '/b' } }) : new Response('B')));
  const web = new WebTransport(fakeStore(), { fetchImpl });
  await assert.rejects(web.fetch('https://example.org/'), IcorsiError);
  assert.equal(await (await web.fetch('/a')).text(), 'B');
});

test('a redirect to the login page means the session expired', async () => {
  const web = new WebTransport(fakeStore(), { fetchImpl: fakeFetch(() => new Response(null, { status: 303, headers: { location: 'https://www.icorsi.ch/login/index.php' } })) });
  await assert.rejects(web.fetch('/my/'), SessionExpired);
});

test('app-scheme and external redirects come back with externalUrl', async () => {
  const app = tokenUrl('1'.repeat(32));
  const web = new WebTransport(fakeStore(), { fetchImpl: fakeFetch((u) => new Response(null, { status: 302, headers: { location: u.pathname === '/x' ? app : 'https://youtube.com/v' } })) });
  assert.equal((await web.fetch('/x')).externalUrl, app);
  assert.equal((await web.fetch('/y')).externalUrl, 'https://youtube.com/v');
});

test('withSession logs in once more when the session expires mid-way', async () => {
  const store = fakeStore();
  const fetchImpl = fakeFetch((u, init, n) => (n === 1 ? new Response(null, { status: 303, headers: { location: '/login/index.php' } }) : new Response('fine')));
  const web = new WebTransport(store, { fetchImpl });
  assert.equal(await web.getHtml('/my/'), 'fine');
  assert.equal(store.logins, 1);
  assert.equal(fetchImpl.seen[1].init.headers.cookie, 'MoodleSession=new1');
});

test('withSession logs in first when there are no cookies', async () => {
  const store = fakeStore({ cookies: {} });
  await new WebTransport(store, { fetchImpl: fakeFetch(() => new Response('x')) }).get('/my/');
  assert.equal(store.logins, 1);
});

test('batch boots the sesskey from the dashboard and settles each call', async () => {
  const fetchImpl = fakeFetch((u, init) => {
    if (u.pathname === '/my/') return new Response(MY);
    assert.equal(u.pathname, '/lib/ajax/service.php');
    assert.equal(u.searchParams.get('sesskey'), 'S1');
    assert.equal(u.searchParams.get('info'), '2-method-calls');
    assert.deepEqual(JSON.parse(init.body).map((c) => c.methodname), ['mod_board_get_board', 'mod_board_get_comments']);
    return jsonResponse([{ error: false, data: [{ id: 1 }] }, { error: true, exception: { message: 'nope', errorcode: 'nopermissions' } }]);
  });
  const web = new WebTransport(fakeStore(), { fetchImpl });
  const [a, b] = await web.batch([{ fn: 'mod_board_get_board', args: { id: 1 } }, { fn: 'mod_board_get_comments', args: { noteid: 2 } }]);
  assert.deepEqual(a, { data: [{ id: 1 }] });
  assert.equal(b.error.code, 'nopermissions');
  assert.deepEqual(await web.batch([]), []);
});

test('call throws the error of its single function', async () => {
  const fetchImpl = fakeFetch((u) => (u.pathname === '/my/' ? new Response(MY) : jsonResponse([{ error: true, exception: { message: 'nope', errorcode: 'x' } }])));
  await assert.rejects(new WebTransport(fakeStore(), { fetchImpl }).call('mod_board_get_comments', { noteid: 2 }), /nope/);
});

test('batch refuses write functions before sending anything', async () => {
  const fetchImpl = fakeFetch(() => { throw new Error('must not fetch'); });
  await assert.rejects(new WebTransport(fakeStore(), { fetchImpl }).batch([{ fn: 'mod_board_add_note', args: {} }]), ReadOnlyViolation);
  assert.equal(fetchImpl.seen.length, 0);
});

test('an invalid sesskey triggers a new login and a new sesskey', async () => {
  const store = fakeStore();
  let ajax = 0;
  const fetchImpl = fakeFetch((u) => {
    if (u.pathname === '/my/') return new Response(MY);
    ajax++;
    return ajax === 1 ? jsonResponse({ error: 'x', errorcode: 'invalidsesskey' }) : jsonResponse([{ error: false, data: 42 }]);
  });
  const web = new WebTransport(store, { fetchImpl });
  assert.equal(await web.call('core_message_get_member_info', {}), 42);
  assert.equal(store.logins, 1);
  assert.equal(fetchImpl.seen.filter((s) => s.url.pathname === '/my/').length, 2);
});
