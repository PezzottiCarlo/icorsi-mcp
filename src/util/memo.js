// Short-lived promise cache: lookups repeated within a burst of tool calls hit iCorsi once.

export class Memo {
  #ttl;
  #now;
  #entries = new Map();

  constructor(ttlMs = 60_000, now = Date.now) {
    this.#ttl = ttlMs;
    this.#now = now;
  }

  get(key, fn) {
    const hit = this.#entries.get(key);
    if (hit && this.#now() - hit.at < this.#ttl) return hit.promise;
    const promise = Promise.resolve().then(fn);
    // a failure is not remembered: the next caller tries again
    promise.catch(() => { if (this.#entries.get(key)?.promise === promise) this.#entries.delete(key); });
    this.#entries.set(key, { at: this.#now(), promise });
    return promise;
  }

  clear() {
    this.#entries.clear();
  }
}
