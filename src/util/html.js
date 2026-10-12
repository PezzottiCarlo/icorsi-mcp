// Moodle rich text (HTML fragments) -> plain text, links and files.

import * as cheerio from 'cheerio';
import { BASE } from '../config.js';
import { clean } from './text.js';
import { isFileUrl, fileKey, fileNameFromUrl, publicFileUrl } from './url.js';

export const MAX_TEXT = 15_000;
const BLOCKS = 'p, div, li, h1, h2, h3, h4, h5, h6, tr, blockquote, pre, table, ul, ol';

/** Plain text of an HTML fragment, keeping paragraph breaks. `remove` drops matching elements first. */
export function htmlToText(html, { max = MAX_TEXT, remove } = {}) {
  if (!html) return '';
  const $ = cheerio.load(html, null, false);
  $('script, style, template, noscript').remove();
  if (remove) $(remove).remove();
  $('br').replaceWith('\n');
  $(BLOCKS).each((_, el) => { $(el).append('\n'); });
  $('td, th').each((_, el) => { $(el).append(' '); });
  return $.root().text()
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/**
 * External links and iCorsi files referenced by an HTML fragment (anchors and embedded media).
 * `internal: true` also keeps links to iCorsi pages.
 */
export function htmlLinks(html, { internal = false } = {}) {
  const links = new Map();
  const files = new Map();
  if (!html) return { links: [], files: [] };
  const $ = cheerio.load(html, null, false);
  const add = (url, name) => {
    if (!url || !/^https?:/.test(url)) return;
    if (url.startsWith(BASE) && isFileUrl(url)) {
      const key = fileKey(url);
      if (!files.has(key)) files.set(key, { name: name || fileNameFromUrl(url), url: publicFileUrl(url) });
    } else if ((internal || !url.startsWith(BASE)) && !links.has(url)) {
      links.set(url, { name: name || url, url });
    }
  };
  $('a[href]').each((_, a) => add($(a).attr('href'), clean($(a).text())));
  $('iframe[src], embed[src], source[src], video[src], audio[src]').each((_, el) => add($(el).attr('src')));
  $('object[data]').each((_, el) => add($(el).attr('data')));
  return { links: [...links.values()], files: [...files.values()] };
}
