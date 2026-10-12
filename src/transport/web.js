// The iCorsi website with the cookie session: pages, redirects and the AJAX service (sesskey)
// the site itself uses. Needed for the token launch, mod_board_*, folder zips and a few
// functions the mobile web service does not offer.

import { BASE } from '../config.js';
import { IcorsiError, SessionExpired } from '../errors.js';
import { assertReadOnly } from './readonly.js';

const EXPIRED = new Set(['servicerequireslogin', 'invalidsesskey', 'requireloginerror']);

export class WebTransport {
  #store;
  #fetch;
  #sesskey = null;
  #booting = null;

  constructor(store, { fetchImpl = globalThis.fetch } = {}) {
    this.#store = store;
    this.#fetch = fetchImpl;
  }

  /**
   * One request with the session cookies. Same-site redirects are followed; a redirect leaving
   * iCorsi (another site, or the moodlemobile:// app scheme) is returned with res.externalUrl set.
   */
  async fetch(target, init = {}, hops = 0) {
    const url = new URL(target, BASE);
    if (url.origin !== BASE) throw new IcorsiError(`Not an iCorsi URL: ${url}`);
    const res = await this.#fetch(url, {
      ...init,
      redirect: 'manual',
      headers: {
        'user-agent': this.#store.userAgent,
        'accept-language': 'it-IT,it;q=0.9',
        cookie: Object.entries(this.#store.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        ...init.headers,
      },
    });
    for (const sc of res.headers.getSetCookie?.() ?? []) {
      const [, name, value] = sc.match(/^([^=]+)=([^;]*)/) ?? [];
      if (name) this.#store.setCookie(name, value);
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const location = res.headers.get('location') ?? '';
      if (/^[a-z][a-z0-9+.-]*:/i.test(location) && !/^https?:/i.test(location)) {
        res.externalUrl = location; // app scheme (moodlemobile://)
        return res;
      }
      const next = new URL(location, url);
      // Moodle redirects to the login page when the session is gone
      if (/^\/(login|auth)\//.test(next.pathname) || /microsoftonline/.test(next.host)) throw new SessionExpired('iCorsi session expired');
      if (next.origin !== BASE) {
        res.externalUrl = next.href;
        return res;
      }
      if (init.method === 'POST' || hops >= 5) throw new IcorsiError(`iCorsi unexpected redirect on ${url.pathname} -> ${next}`);
      return this.fetch(next, init, hops + 1);
    }
    if (!res.ok) throw new IcorsiError(`iCorsi HTTP ${res.status} on ${url.pathname}`, { code: res.status });
    return res;
  }

  /** Forgets the sesskey (after a new login it belongs to the old session) */
  reset() {
    this.#sesskey = null;
  }

  /** Runs fn with a live session: logs in when there is none, and once more if it expires mid-way */
  async withSession(fn) {
    if (!this.#store.hasCookies()) await this.#store.login();
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof SessionExpired)) throw e;
      this.#sesskey = null;
      await this.#store.login();
      return fn();
    }
  }

  /** GET with session handling; the body is left unread */
  get(target) {
    return this.withSession(() => this.fetch(target));
  }

  getHtml(target) {
    return this.withSession(async () => (await this.fetch(target)).text());
  }

  // The dashboard page carries the sesskey the AJAX service wants (M.cfg)
  async #getSesskey() {
    if (this.#sesskey) return this.#sesskey;
    return this.#booting ??= (async () => {
      const html = await (await this.fetch('/my/')).text();
      const cfg = JSON.parse(html.match(/M\.cfg = (\{.*?\});/s)?.[1] ?? '{}');
      if (!cfg.sesskey || !cfg.userId) throw new SessionExpired('iCorsi session expired');
      return (this.#sesskey = cfg.sesskey);
    })().finally(() => { this.#booting = null; });
  }

  /** Several read-only AJAX functions in one request: [{ fn, args }] -> [{ data } | { error }] */
  async batch(calls) {
    for (const c of calls) assertReadOnly(c.fn);
    if (!calls.length) return [];
    return this.withSession(async () => {
      // the service stops at the first failing function: the ones after it are sent again
      const results = [];
      while (results.length < calls.length) results.push(...await this.#send(calls.slice(results.length)));
      return results;
    });
  }

  async #send(calls) {
    const sesskey = await this.#getSesskey();
    const info = calls.length === 1 ? calls[0].fn : `${calls.length}-method-calls`;
    const res = await this.fetch(`/lib/ajax/service.php?sesskey=${sesskey}&info=${info}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/javascript, */*; q=0.01',
        'x-requested-with': 'XMLHttpRequest',
        origin: BASE,
        referer: `${BASE}/my/`,
      },
      body: JSON.stringify(calls.map((c, index) => ({ index, methodname: c.fn, args: c.args ?? {} }))),
    });
    const out = await res.json();
    if (!Array.isArray(out)) {
      if (EXPIRED.has(out.errorcode)) { this.#sesskey = null; throw new SessionExpired('iCorsi session expired'); }
      throw new IcorsiError(`iCorsi ajax error: ${out.error ?? out.message ?? JSON.stringify(out)}`, { code: out.errorcode });
    }
    if (!out.length) throw new IcorsiError('iCorsi ajax error: empty answer');
    return out.slice(0, calls.length).map((r, i) => {
      if (!r.error) return { data: r.data };
      const ex = r.exception ?? {};
      if (EXPIRED.has(ex.errorcode)) { this.#sesskey = null; throw new SessionExpired('iCorsi session expired'); }
      return { error: new IcorsiError(`iCorsi ${calls[i].fn}: ${ex.message ?? ex.errorcode ?? 'unknown error'}`, { code: ex.errorcode }) };
    });
  }

  /** One read-only AJAX function; throws on error */
  async call(fn, args = {}) {
    const [r] = await this.batch([{ fn, args }]);
    if (r.error) throw r.error;
    return r.data;
  }
}
