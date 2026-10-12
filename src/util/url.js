// iCorsi URL helpers.

import { BASE } from '../config.js';

export const isFileUrl = (url) => /\/pluginfile\.php\//.test(url ?? '');

/** Browser-openable file URL: no /webservice prefix, no token, no forcedownload */
export function publicFileUrl(url) {
  if (!url) return url;
  const u = new URL(url, BASE);
  u.pathname = u.pathname.replace(/^\/webservice\/pluginfile\.php\//, '/pluginfile.php/');
  u.searchParams.delete('token');
  u.searchParams.delete('forcedownload');
  return u.href;
}

/** The same file is linked with and without /webservice and ?forcedownload=1 */
export const fileKey = (url) => publicFileUrl(url).split('?')[0];

/** File name from a pluginfile URL (the Content-Disposition header has broken accents) */
export function fileNameFromUrl(url) {
  const last = new URL(url, BASE).pathname.split('/').pop();
  try { return decodeURIComponent(last); } catch { return last; }
}

/** Course module id from an activity URL: /mod/<type>/view.php?id=<cmid> */
export function cmidFromUrl(url) {
  const u = new URL(url, BASE);
  if (u.origin !== BASE || !/^\/mod\/[a-z0-9]+\/view\.php$/.test(u.pathname)) return null;
  return Number(u.searchParams.get('id')) || null;
}

/** Discussion id from /mod/forum/discuss.php?d=<id> */
export function discussionIdFromUrl(url) {
  const u = new URL(url, BASE);
  if (u.origin !== BASE || u.pathname !== '/mod/forum/discuss.php') return null;
  return Number(u.searchParams.get('d')) || null;
}
