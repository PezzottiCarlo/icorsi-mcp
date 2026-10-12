// Mappers and lookups shared by the services and the activity handlers.

import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';
import { publicFileUrl } from '../util/url.js';

const COMPLETION = { 0: 'incomplete', 1: 'complete', 2: 'pass', 3: 'fail' };

/**
 * Moodle file lists (contents, introfiles, attachments) -> [{ name, url, ... }]; url/content entries are skipped.
 * Most functions name the link fileurl, forum post attachments name it url.
 */
export const mapFiles = (list) => (list ?? [])
  .filter((f) => (!f.type || f.type === 'file') && (f.fileurl || f.url))
  .map((f) => compact({
    name: f.filename,
    folder: f.filepath && f.filepath !== '/' ? f.filepath : undefined,
    url: publicFileUrl(f.fileurl ?? f.url),
    size: f.filesize || undefined,
    mimetype: f.mimetype,
    modified: toIso(f.timemodified),
  }));

export const completionOf = (mod) => (mod?.completiondata ? COMPLETION[mod.completiondata.state] : undefined);

export const datesOf = (mod) => (mod?.dates ?? []).map((d) => ({ label: d.label, date: toIso(d.timestamp) }));

/** '-' and '' mean "no value" in grade reports */
export const dash = (s) => (s == null || s === '' || s === '-' ? null : decode(String(s)));

export const introOf = (x) => compact({ intro: htmlToText(x?.intro), introFiles: mapFiles(x?.introfiles) });

/** The instance of an activity among mod_<type>_get_<plural>_by_courses results (cached per course) */
export async function instanceOf(ctx, fn, key, cm) {
  const res = await ctx.cache.get(`${fn}:${cm.course}`, () => ctx.ws.call(fn, { courseids: [cm.course] }));
  const list = key ? res?.[key] : res;
  return (list ?? []).find((x) => (x.coursemodule ?? x.cmid) === cm.id) ?? null;
}
