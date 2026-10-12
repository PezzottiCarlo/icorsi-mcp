// .session.json: login cookies, the browser user agent and the mobile web service token.

import fs from 'node:fs';
import { PATHS, DEFAULT_USER_AGENT } from '../config.js';
import { browserLogin } from './browser-login.js';

export class SessionStore {
  #file;
  #interactive;
  #login;
  #data = null;
  #inflight = null;

  constructor({ file = PATHS.session, interactive = true, login = browserLogin } = {}) {
    this.#file = file;
    this.#interactive = interactive; // false: never open a visible browser window
    this.#login = login;
  }

  get #state() {
    if (!this.#data) {
      try { this.#data = JSON.parse(fs.readFileSync(this.#file, 'utf8')); } catch { this.#data = {}; }
      this.#data.cookies ??= {};
    }
    return this.#data;
  }

  get cookies() { return this.#state.cookies; }
  get userAgent() { return this.#state.userAgent ?? DEFAULT_USER_AGENT; }
  get token() { return this.#state.wstoken ?? null; }

  hasCookies() {
    return Object.keys(this.cookies).length > 0;
  }

  setCookie(name, value) {
    this.cookies[name] = value;
    this.#save();
  }

  setToken(token) {
    this.#state.wstoken = token ?? undefined;
    this.#save();
  }

  /** New browser login; concurrent callers share it (the browser profile can't be opened twice) */
  login() {
    return this.#inflight ??= (async () => {
      const session = await this.#login({ interactive: this.#interactive });
      this.#data = { ...session, cookies: session.cookies ?? {}, wstoken: this.#state.wstoken };
      this.#save();
    })().finally(() => { this.#inflight = null; });
  }

  #save() {
    fs.writeFileSync(this.#file, JSON.stringify(this.#state, null, 2), { mode: 0o600 });
    fs.chmodSync(this.#file, 0o600); // mode only applies when the file is created
  }
}
