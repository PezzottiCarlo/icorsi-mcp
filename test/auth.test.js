import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/auth/session-store.js';
import { launchPath, parseLaunchRedirect, fetchMobileToken } from '../src/auth/mobile-token.js';
import { TokenInvalid } from '../src/errors.js';
import { tokenUrl } from './helpers.js';

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'icorsi-')), 'session.json');

test('SessionStore starts empty and persists cookies and token with mode 600', () => {
  const file = tmpFile();
  const store = new SessionStore({ file, login: async () => { throw new Error('no'); } });
  assert.equal(store.hasCookies(), false);
  assert.equal(store.token, null);
  assert.match(store.userAgent, /Mozilla/);
  store.setCookie('MoodleSession', 'abc');
  store.setToken('t'.repeat(32));
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(saved.cookies, { MoodleSession: 'abc' });
  assert.equal(saved.wstoken, 't'.repeat(32));
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  store.setToken(null);
  assert.equal(new SessionStore({ file }).token, null);
});

test('SessionStore.login keeps the token and is shared by concurrent callers', async () => {
  const file = tmpFile();
  let logins = 0;
  const store = new SessionStore({ file, login: async () => { logins++; return { savedAt: 1, userAgent: 'UA', cookies: { M: '1' } }; } });
  store.setToken('k'.repeat(32));
  await Promise.all([store.login(), store.login()]);
  assert.equal(logins, 1);
  assert.equal(store.userAgent, 'UA');
  assert.deepEqual(store.cookies, { M: '1' });
  assert.equal(store.token, 'k'.repeat(32));
});

test('launchPath asks for the mobile app service', () => {
  const p = new URL(launchPath('p1'), 'https://www.icorsi.ch');
  assert.equal(p.pathname, '/admin/tool/mobile/launch.php');
  assert.equal(p.searchParams.get('service'), 'moodle_mobile_app');
  assert.equal(p.searchParams.get('urlscheme'), 'moodlemobile');
  assert.equal(p.searchParams.get('passport'), 'p1');
});

test('parseLaunchRedirect extracts the token and rejects anything else', () => {
  assert.equal(parseLaunchRedirect(tokenUrl('b'.repeat(32))), 'b'.repeat(32));
  assert.throws(() => parseLaunchRedirect('https://www.icorsi.ch/login/index.php'), TokenInvalid);
  assert.throws(() => parseLaunchRedirect(undefined), TokenInvalid);
  assert.throws(() => parseLaunchRedirect(`moodlemobile://token=${Buffer.from('x:::short').toString('base64')}`), TokenInvalid);
});

test('fetchMobileToken reads the app redirect or the iOS launch page', async () => {
  const redirect = { get: async () => ({ externalUrl: tokenUrl('1'.repeat(32)) }) };
  assert.equal(await fetchMobileToken(redirect), '1'.repeat(32));
  const page = { get: async () => new Response(`<a id="launchapp" href="${tokenUrl('2'.repeat(32))}">open</a>`) };
  assert.equal(await fetchMobileToken(page), '2'.repeat(32));
});
