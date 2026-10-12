import test from 'node:test';
import assert from 'node:assert/strict';
import { WsTransport, flattenParams } from '../src/transport/ws.js';
import { IcorsiError, ReadOnlyViolation } from '../src/errors.js';
import { fakeStore, jsonResponse, tokenUrl } from './helpers.js';

const T1 = '1'.repeat(32);
const T2 = '2'.repeat(32);

// web double: launch.php always answers with a redirect carrying T2
function fakeWeb() {
  const web = { launches: 0, get: async () => { web.launches++; return { externalUrl: tokenUrl(T2) }; } };
  return web;
}

// fetch double for server.php and pluginfile.php: handler(fields, url, n) -> Response
function wsFetch(handler) {
  const seen = [];
  const f = async (url, init = {}) => {
    const u = new URL(url);
    const fields = new URLSearchParams(init.body ?? '');
    seen.push({ url: u, fields });
    return handler(fields, u, seen.length);
  };
  f.seen = seen;
  return f;
}

test('flattenParams writes PHP-style nested fields', () => {
  assert.equal(
    flattenParams({ courseids: [1, 2], options: { a: true, b: false }, n: null, s: 'x' }).toString(),
    'courseids%5B0%5D=1&courseids%5B1%5D=2&options%5Ba%5D=1&options%5Bb%5D=0&s=x',
  );
});

test('call posts the function with the token and returns the JSON', async () => {
  const fetchImpl = wsFetch((f) => jsonResponse({ fn: f.get('wsfunction'), token: f.get('wstoken'), format: f.get('moodlewsrestformat'), id: f.get('courseid') }));
  const ws = new WsTransport(fakeStore({ token: T1 }), fakeWeb(), { fetchImpl });
  assert.deepEqual(await ws.call('core_course_get_contents', { courseid: 5 }), { fn: 'core_course_get_contents', token: T1, format: 'json', id: '5' });
  assert.equal(fetchImpl.seen[0].url.pathname, '/webservice/rest/server.php');
});

test('call turns a web service exception into IcorsiError with its code', async () => {
  const ws = new WsTransport(fakeStore({ token: T1 }), fakeWeb(), { fetchImpl: wsFetch(() => jsonResponse({ exception: 'moodle_exception', errorcode: 'nopermissions', message: 'No way' })) });
  await assert.rejects(ws.call('core_notes_get_course_notes', {}), (e) => e instanceof IcorsiError && e.code === 'nopermissions' && /No way/.test(e.message));
});

test('an invalid token is replaced once and the call retried', async () => {
  const store = fakeStore({ token: T1 });
  const web = fakeWeb();
  const fetchImpl = wsFetch((f) => (f.get('wstoken') === T1 ? jsonResponse({ exception: 'x', errorcode: 'invalidtoken', message: 'Invalid token' }) : jsonResponse({ ok: true })));
  const ws = new WsTransport(store, web, { fetchImpl });
  assert.deepEqual(await ws.call('core_webservice_get_site_info'), { ok: true });
  assert.equal(store.token, T2);
  assert.equal(web.launches, 1);
});

test('concurrent calls share one token launch', async () => {
  const store = fakeStore({ token: null });
  const web = fakeWeb();
  const ws = new WsTransport(store, web, { fetchImpl: wsFetch(() => jsonResponse(1)) });
  await Promise.all([ws.call('core_course_get_contents', { courseid: 1 }), ws.call('core_course_get_contents', { courseid: 2 })]);
  assert.equal(web.launches, 1);
  assert.equal(store.token, T2);
});

test('call and batch refuse write functions before sending anything', async () => {
  const fetchImpl = wsFetch(() => { throw new Error('must not fetch'); });
  const ws = new WsTransport(fakeStore(), fakeWeb(), { fetchImpl });
  await assert.rejects(ws.call('core_message_send_instant_messages', {}), ReadOnlyViolation);
  await assert.rejects(ws.batch([{ fn: 'core_course_get_contents' }, { fn: 'mod_forum_add_discussion', args: {} }]), ReadOnlyViolation);
  assert.equal(fetchImpl.seen.length, 0);
});

// Like Moodle: tool_mobile_call_external_functions stops at the first failing request
const stopAtFirstError = (failing) => wsFetch((f) => {
  assert.equal(f.get('wsfunction'), 'tool_mobile_call_external_functions');
  const responses = [];
  for (let i = 0; f.has(`requests[${i}][function]`); i++) {
    const args = JSON.parse(f.get(`requests[${i}][arguments]`));
    if (failing.has(args.courseid)) {
      responses.push({ error: true, exception: JSON.stringify({ message: 'Course not found', errorcode: 'invalidrecord' }) });
      break;
    }
    responses.push({ error: false, data: JSON.stringify({ course: args.courseid }) });
  }
  return jsonResponse({ responses });
});

test('batch splits into chunks, keeps order and settles errors per item', async () => {
  const fetchImpl = stopAtFirstError(new Set([13]));
  const ws = new WsTransport(fakeStore(), fakeWeb(), { fetchImpl, chunk: 25, concurrency: 2 });
  const out = await ws.batch(Array.from({ length: 30 }, (_, i) => ({ fn: 'core_course_get_contents', args: { courseid: i } })));
  assert.equal(out.length, 30);
  assert.deepEqual(out[12], { data: { course: 12 } });
  assert.equal(out[13].error.code, 'invalidrecord');
  assert.deepEqual(out[14], { data: { course: 14 } });
  assert.deepEqual(out[24], { data: { course: 24 } });
  assert.deepEqual(out[29], { data: { course: 29 } });
  assert.equal(fetchImpl.seen.length, 3); // the calls after the failing one are sent again
  assert.deepEqual(await ws.batch([]), []);
});

test('batch resends after every failing item, also consecutive ones', async () => {
  const ws = new WsTransport(fakeStore(), fakeWeb(), { fetchImpl: stopAtFirstError(new Set([0, 1, 4])) });
  const out = await ws.batch(Array.from({ length: 6 }, (_, i) => ({ fn: 'core_course_get_contents', args: { courseid: i } })));
  assert.deepEqual(out.map((r) => (r.error ? 'error' : r.data.course)), ['error', 'error', 2, 3, 'error', 5]);
});

test('file() goes through /webservice/pluginfile.php with the token', async () => {
  const fetchImpl = wsFetch(() => new Response('%PDF', { headers: { 'content-type': 'application/pdf' } }));
  const ws = new WsTransport(fakeStore({ token: T1 }), fakeWeb(), { fetchImpl });
  const res = await ws.file('https://www.icorsi.ch/pluginfile.php/9/mod_resource/content/1/a.pdf?forcedownload=1');
  assert.equal(await res.text(), '%PDF');
  const u = fetchImpl.seen[0].url;
  assert.equal(u.pathname, '/webservice/pluginfile.php/9/mod_resource/content/1/a.pdf');
  assert.equal(u.searchParams.get('token'), T1);
  await assert.rejects(ws.file('https://www.icorsi.ch/mod/page/view.php?id=1'), IcorsiError);
  await assert.rejects(ws.file('https://evil.example/pluginfile.php/1/a'), IcorsiError);
});

test('file() refreshes an invalid token answered as 200 JSON and never leaks it', async () => {
  const store = fakeStore({ token: T1 });
  const fetchImpl = wsFetch((f, u) => (u.searchParams.get('token') === T1
    ? jsonResponse({ error: 'Invalid token - token not found', errorcode: 'invalidtoken' })
    : new Response('data', { headers: { 'content-type': 'text/plain' } })));
  const ws = new WsTransport(store, fakeWeb(), { fetchImpl });
  assert.equal(await ws.fileText('https://www.icorsi.ch/webservice/pluginfile.php/2/mod_book/chapter/3/index.html'), 'data');
  assert.equal(store.token, T2);

  const failing = new WsTransport(fakeStore({ token: T1 }), fakeWeb(), { fetchImpl: wsFetch(() => new Response('gone', { status: 404 })) });
  await assert.rejects(failing.file('https://www.icorsi.ch/pluginfile.php/2/x.pdf'), (e) => !e.message.includes(T1) && /404/.test(e.message));
});

test('file() passes real JSON files through untouched', async () => {
  const ws = new WsTransport(fakeStore({ token: T1 }), fakeWeb(), { fetchImpl: wsFetch(() => jsonResponse({ a: 1 })) });
  assert.deepEqual(await (await ws.file('https://www.icorsi.ch/pluginfile.php/1/data.json')).json(), { a: 1 });
});
