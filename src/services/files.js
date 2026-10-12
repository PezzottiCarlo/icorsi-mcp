// Downloads: files through the web service, folders as zip through the website.

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { BASE, PATHS } from '../config.js';
import { IcorsiError } from '../errors.js';
import { cmidFromUrl, fileNameFromUrl, isFileUrl } from '../util/url.js';
import { getActivity } from './activities.js';

/** File name of generated downloads (folder zips): only the Content-Disposition header has it */
export function dispositionName(header) {
  const star = header?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (star) return decodeURIComponent(star);
  const plain = header?.match(/filename="?([^";]+)"?/)?.[1];
  return plain ? Buffer.from(plain, 'latin1').toString('utf8') : null; // utf8 bytes read as latin1
}

export const safeName = (name) => name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

// url -> { res, name, file } where file=true means a real pluginfile (HTML allowed)
async function open(ctx, url) {
  const u = new URL(url, BASE);
  if (u.origin !== BASE) throw new IcorsiError(`Only www.icorsi.ch URLs can be downloaded: ${url}`);
  if (isFileUrl(u.pathname)) return { res: await ctx.ws.file(u.href), name: fileNameFromUrl(u.href), file: true };
  if (u.pathname === '/mod/folder/download_folder.php') {
    const res = await ctx.web.get(u.href);
    return { res, name: dispositionName(res.headers.get('content-disposition')) ?? `folder-${u.searchParams.get('id')}.zip` };
  }
  const cmid = cmidFromUrl(u.href);
  if (!cmid) throw new IcorsiError(`Not a file or an activity URL: ${url}`);
  const activity = await getActivity(ctx, { cmid });
  if (activity.type === 'folder') return open(ctx, `${BASE}/mod/folder/download_folder.php?id=${cmid}`);
  const files = activity.files ?? [];
  if (files.length !== 1) throw new IcorsiError(`Not a single file: that activity has ${files.length} files, list them with icorsi_get_activity`);
  return open(ctx, files[0].url);
}

/** Saves a file, a File activity's file or a folder zip in `dir`; returns the local path */
export async function download(ctx, url, { dir = PATHS.downloads } = {}) {
  const { res, name, file } = await open(ctx, url);
  if (res.externalUrl) throw new IcorsiError(`Not a file: it redirects to ${res.externalUrl}`);
  if (!file && /text\/html/.test(res.headers.get('content-type') ?? '')) {
    await res.body?.cancel();
    throw new IcorsiError(`Not a file: ${url} is a web page`);
  }
  const fileName = safeName(name);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, fileName);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target));
  return { path: target, name: fileName, mimeType: res.headers.get('content-type'), size: fs.statSync(target).size };
}
