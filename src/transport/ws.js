// The Moodle mobile-app web service (REST + token): the main data channel. Only read-only
// functions are sent; many calls travel together through tool_mobile_call_external_functions.

import { BASE } from '../config.js';
import { IcorsiError, TokenInvalid } from '../errors.js';
import { fetchMobileToken } from '../auth/mobile-token.js';
import { isFileUrl } from '../util/url.js';
import { pool } from '../util/pool.js';
import { assertReadOnly } from './readonly.js';

export const WS_PATH = '/webservice/rest/server.php';
const BATCH_FN = 'tool_mobile_call_external_functions';

/** Nested args -> PHP-style form fields: { a: [1], b: { c: true } } -> a[0]=1&b[c]=1 */
export function flattenParams(value, prefix = '', out = new URLSearchParams()) {
  if (value == null) return out;
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) flattenParams(v, prefix ? `${prefix}[${k}]` : k, out);
  } else {
    out.append(prefix, typeof value === 'boolean' ? (value ? '1' : '0') : String(value));
  }
  return out;
}

const isException = (json) => json != null && typeof json === 'object' && !Array.isArray(json) && 'errorcode' in json && ('exception' in json || 'error' in json);

// topLevel: the answer to the whole request. An expired token is deleted by Moodle and answered
// with a generic accessexception there, so that one is worth one retry with a fresh token too.
function errorOf(json, fn, { topLevel = false } = {}) {
  const message = `iCorsi ${fn}: ${json?.message ?? json?.error ?? json?.errorcode ?? 'unknown error'}`;
  if (json?.errorcode === 'invalidtoken') return new TokenInvalid('iCorsi rejected the web service token', { code: 'invalidtoken' });
  if (topLevel && json?.errorcode === 'accessexception') return new TokenInvalid(message, { code: 'accessexception' });
  return new IcorsiError(message, { code: json?.errorcode });
}

export class WsTransport {
  #store;
  #web;
  #fetch;
  #chunk;
  #concurrency;
  #tokening = null;

  constructor(store, web, { fetchImpl = globalThis.fetch, chunk = 25, concurrency = 4 } = {}) {
    this.#store = store;
    this.#web = web;
    this.#fetch = fetchImpl;
    this.#chunk = chunk;
    this.#concurrency = concurrency;
  }

  // Stored token, or a new one from the mobile launch flow (one launch for all concurrent callers)
  async #token() {
    if (this.#store.token) return this.#store.token;
    return this.#tokening ??= fetchMobileToken(this.#web)
      .then((token) => { this.#store.setToken(token); return token; })
      .finally(() => { this.#tokening = null; });
  }

  async #withToken(fn) {
    const token = await this.#token();
    try {
      return await fn(token);
    } catch (e) {
      if (!(e instanceof TokenInvalid)) throw e;
      if (this.#store.token === token) this.#store.setToken(null);
      return fn(await this.#token());
    }
  }

  async #post(fn, args, token) {
    const body = flattenParams(args);
    body.set('wstoken', token);
    body.set('wsfunction', fn);
    body.set('moodlewsrestformat', 'json');
    const res = await this.#fetch(new URL(WS_PATH, BASE), { method: 'POST', body, headers: { 'user-agent': this.#store.userAgent } });
    if (!res.ok) throw new IcorsiError(`iCorsi HTTP ${res.status} on ${fn}`, { code: res.status });
    const json = await res.json();
    if (isException(json)) throw errorOf(json, fn, { topLevel: true });
    return json;
  }

  /** One read-only web service function; throws on error */
  async call(fn, args = {}) {
    assertReadOnly(fn);
    return this.#withToken((token) => this.#post(fn, args, token));
  }

  /** Many read-only functions: [{ fn, args }] -> [{ data } | { error }] in the same order */
  async batch(calls) {
    for (const c of calls) assertReadOnly(c.fn);
    const chunks = [];
    for (let i = 0; i < calls.length; i += this.#chunk) chunks.push(calls.slice(i, i + this.#chunk));
    const answers = await pool(chunks, this.#concurrency, (chunk) => this.#withToken((token) => this.#runChunk(chunk, token)));
    return answers.flat();
  }

  // Moodle stops a batch at the first failing request: the calls after it did not run, so they are sent again
  async #runChunk(chunk, token) {
    const results = [];
    while (results.length < chunk.length) {
      const pending = chunk.slice(results.length);
      const out = await this.#post(BATCH_FN, {
        requests: pending.map((c) => ({ function: c.fn, arguments: JSON.stringify(c.args ?? {}) })),
      }, token);
      const responses = (out.responses ?? []).slice(0, pending.length);
      if (!responses.length) throw new IcorsiError(`iCorsi ${BATCH_FN}: empty answer`);
      responses.forEach((r, i) => {
        if (!r.error) {
          results.push({ data: r.data == null ? null : JSON.parse(r.data) });
          return;
        }
        let ex;
        try { ex = JSON.parse(r.exception); } catch { ex = { message: String(r.exception) }; }
        const error = errorOf(ex, pending[i].fn);
        if (error instanceof TokenInvalid) throw error; // the whole chunk is retried with a new token
        results.push({ error });
      });
    }
    return results;
  }

  /** A pluginfile URL through the web service (token in the query); the body is left unread */
  async file(url) {
    const u = new URL(url, BASE);
    if (u.origin !== BASE || !isFileUrl(u.pathname)) throw new IcorsiError(`Not an iCorsi file URL: ${url}`);
    u.pathname = u.pathname.replace(/^\/(webservice\/)?pluginfile\.php\//, '/webservice/pluginfile.php/');
    const shown = u.pathname; // messages never carry the token
    return this.#withToken(async (token) => {
      u.searchParams.set('token', token);
      const res = await this.#fetch(u, { headers: { 'user-agent': this.#store.userAgent } });
      if (!res.ok) {
        await res.body?.cancel();
        throw new IcorsiError(`iCorsi HTTP ${res.status} on ${shown}`, { code: res.status });
      }
      // a bad token is answered 200 with a JSON error body
      if (!/application\/json/.test(res.headers.get('content-type') ?? '')) return res;
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* not JSON after all */ }
      if (isException(json)) throw errorOf(json, shown, { topLevel: true });
      return new Response(text, { status: res.status, headers: res.headers });
    });
  }

  async fileText(url) {
    return (await this.file(url)).text();
  }
}
