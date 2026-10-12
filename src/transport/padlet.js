// Padlet walls linked from a course: posts through padlet.com's public API (no login, read-only).

import { IcorsiError } from '../errors.js';
import { htmlToText } from '../util/html.js';
import { compact, decode } from '../util/text.js';

const ORIGIN = 'https://padlet.com';
const MAX_PAGES = 10;

export function isPadletUrl(url) {
  try { return new URL(url).hostname === 'padlet.com'; } catch { return false; }
}

/** The wall id sits in the page's preload link: /api/10/wishes?wall_hashid=board_... */
export const wallHashid = (html) => html.match(/wall_hashid=(board_[A-Za-z0-9]+)/)?.[1] ?? null;

export const mapWish = ({ attributes: a }) => compact({
  id: a.id,
  subject: decode(a.headline || a.subject) || undefined,
  text: htmlToText(a.body, { max: 3000 }),
  attachment: a.attachment || a.attachment_link || undefined,
  date: a.created_at ?? a.updated_at,
  url: a.permalink,
});

export class PadletClient {
  #fetch;
  #userAgent;

  constructor({ fetchImpl = globalThis.fetch, userAgent } = {}) {
    this.#fetch = fetchImpl;
    this.#userAgent = userAgent;
  }

  async #get(url, accept) {
    const res = await this.#fetch(url, { headers: { ...(this.#userAgent && { 'user-agent': this.#userAgent }), accept } });
    if (!res.ok) throw new IcorsiError(`Padlet HTTP ${res.status} on ${new URL(url).pathname}`);
    return res;
  }

  async getWall(url) {
    if (!isPadletUrl(url)) throw new IcorsiError(`Not a padlet.com URL: ${url}`);
    const html = await (await this.#get(url, 'text/html')).text();
    const hashid = wallHashid(html);
    if (!hashid) throw new IcorsiError('Padlet wall id not found (private or deleted wall?)');
    const title = decode(html.match(/<title>([^<]*)<\/title>/)?.[1]?.trim()) || null;
    const posts = [];
    let start = '';
    for (let page = 0; page < MAX_PAGES; page++) {
      const qs = new URLSearchParams({ wall_hashid: hashid, page_start: start });
      const data = await (await this.#get(`${ORIGIN}/api/10/wishes?${qs}`, 'application/json')).json();
      posts.push(...(data.data ?? []).map(mapWish));
      start = data.meta?.next;
      if (!start) break;
    }
    return { url, title, posts };
  }
}
