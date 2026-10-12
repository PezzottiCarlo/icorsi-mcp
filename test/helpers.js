// Test doubles: a fake service context, a fake session store and fetch responses.

import { Memo } from '../src/util/memo.js';

/**
 * Fake service context. `ws` / `web` map a function name to a response, to a function(args)
 * returning one, or to an Error (thrown). Every call is recorded in `calls`.
 */
export function fakeCtx({ ws = {}, web = {}, files = {}, fileResponses = {}, padlet, userId = 7 } = {}) {
  const calls = [];
  const answer = (map, kind) => async (fn, args = {}) => {
    calls.push({ kind, fn, args });
    if (!(fn in map)) throw new Error(`unexpected ${kind} call ${fn}`);
    const r = map[fn];
    const value = typeof r === 'function' ? await r(args) : structuredClone(r);
    if (value instanceof Error) throw value;
    return value;
  };
  const settle = (call) => (list) => Promise.all(list.map(({ fn, args }) => call(fn, args).then((data) => ({ data }), (error) => ({ error }))));
  const wsCall = answer(ws, 'ws');
  const webCall = answer(web, 'web');
  return {
    calls,
    cache: new Memo(60_000),
    userId: async () => userId,
    siteInfo: async () => ({ userid: userId, fullname: 'Test Student', username: 'test@example.org', lang: 'it', userquota: 1000 }),
    ws: {
      call: wsCall,
      batch: settle(wsCall),
      fileText: async (url) => files[url] ?? '',
      file: async (url) => {
        calls.push({ kind: 'file', fn: url });
        if (!(url in fileResponses)) throw new Error(`unexpected file ${url}`);
        return fileResponses[url]();
      },
    },
    web: {
      call: webCall,
      batch: settle(webCall),
      get: async (url) => {
        calls.push({ kind: 'get', fn: url });
        if (!(url in fileResponses)) throw new Error(`unexpected get ${url}`);
        return fileResponses[url]();
      },
    },
    padlet: padlet ?? { getWall: async () => { throw new Error('padlet not expected'); } },
  };
}

/** Fake session store for the transports */
export function fakeStore({ cookies = { MoodleSession: 'abc' }, token = 'f'.repeat(32) } = {}) {
  return {
    cookies,
    userAgent: 'test-agent',
    token,
    logins: 0,
    hasCookies() { return Object.keys(this.cookies).length > 0; },
    setCookie(name, value) { this.cookies[name] = value; },
    setToken(t) { this.token = t ?? null; },
    async login() { this.logins++; this.cookies = { MoodleSession: `new${this.logins}` }; },
  };
}

export const jsonResponse = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  ...init,
  headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
});

/** The app-scheme redirect launch.php answers with */
export const tokenUrl = (token) => `moodlemobile://token=${Buffer.from(`${'a'.repeat(32)}:::${token}:::${'c'.repeat(32)}`).toString('base64')}`;
