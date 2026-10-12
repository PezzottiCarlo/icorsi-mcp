import test from 'node:test';
import assert from 'node:assert/strict';
import { ICorsi } from '../src/client.js';
import { ReadOnlyViolation } from '../src/errors.js';
import { fakeStore, jsonResponse, tokenUrl } from './helpers.js';

test('the facade wires the services and refuses writes on both transports', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(new URLSearchParams(init?.body ?? '').get('wsfunction'));
    return jsonResponse({ userid: 7, fullname: 'Test Student', username: 'u', lang: 'it' });
  };
  const api = new ICorsi({ store: fakeStore(), fetchImpl });
  assert.deepEqual(await api.getUser(), { id: 7, fullname: 'Test Student', username: 'u', lang: 'it' });
  await assert.rejects(api.call('core_message_send_instant_messages', {}), ReadOnlyViolation);
  await assert.rejects(api.call('mod_board_add_note', {}, { transport: 'ajax' }), ReadOnlyViolation);
  await assert.rejects(api.ajax('core_message_mark_notification_read', {}), ReadOnlyViolation);
  assert.deepEqual(seen, ['core_webservice_get_site_info']);
});

test('login gets a new token as well as new cookies', async () => {
  const store = fakeStore({ token: 'f'.repeat(32) });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/admin/tool/mobile/launch.php') return new Response(null, { status: 302, headers: { location: tokenUrl('9'.repeat(32)) } });
    return jsonResponse({ userid: 7, fullname: 'Test Student', username: 'u', lang: 'it' });
  };
  const api = new ICorsi({ store, fetchImpl });
  assert.equal((await api.login()).id, 7);
  assert.equal(store.logins, 1);
  assert.equal(store.token, '9'.repeat(32));
});

test('raw calls never hand credentials to the caller', async () => {
  const fetchImpl = async () => jsonResponse({ userid: 7, userprivateaccesskey: 'k3y', nested: [{ token: 't0k', name: 'x' }] });
  const out = await new ICorsi({ store: fakeStore(), fetchImpl }).call('core_webservice_get_site_info');
  assert.deepEqual(out, { userid: 7, nested: [{ name: 'x' }] });
});
