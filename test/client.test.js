import test from 'node:test';
import assert from 'node:assert/strict';
import { ICorsi } from '../src/client.js';
import { ReadOnlyViolation } from '../src/errors.js';
import { fakeStore, jsonResponse } from './helpers.js';

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
