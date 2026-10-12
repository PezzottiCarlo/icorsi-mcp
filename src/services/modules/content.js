// Content activities: page, book, label, resource, folder, imscp, url (with Padlet walls).

import { BASE } from '../../config.js';
import { compact, decode, toIso } from '../../util/text.js';
import { htmlToText, htmlLinks } from '../../util/html.js';
import { pool } from '../../util/pool.js';
import { isPadletUrl } from '../../transport/padlet.js';
import { instanceOf, introOf, mapFiles } from '../common.js';

export async function page(ctx, cm) {
  const p = await instanceOf(ctx, 'mod_page_get_pages_by_courses', 'pages', cm);
  if (!p) return {};
  const inline = htmlLinks(p.content);
  // images of the page are decoration; other attached files are worth listing
  const attached = mapFiles(p.contentfiles).filter((f) => !/^image\//.test(f.mimetype ?? ''));
  return compact({ ...introOf(p), text: htmlToText(p.content), files: [...inline.files, ...attached], links: inline.links, modified: toIso(p.timemodified) });
}

/** Chapters in table-of-contents order: "structure" holds the TOC, each chapter is an index.html */
export async function book(ctx, cm, mod) {
  const contents = mod?.contents ?? [];
  const toc = JSON.parse(contents.find((c) => c.filename === 'structure')?.content || '[]');
  const flat = [];
  const walk = (items) => { for (const t of items) { flat.push(t); walk(t.subitems ?? []); } };
  walk(toc);
  const pages = new Map(contents.filter((c) => c.filename === 'index.html').map((c) => [c.filepath.replaceAll('/', ''), c]));
  const chapters = await pool(flat, 4, async (t) => {
    const id = t.href.split('/')[0];
    const file = pages.get(id);
    const html = file ? await ctx.ws.fileText(file.fileurl) : '';
    const inline = htmlLinks(html);
    return compact({
      id: Number(id),
      title: decode(t.title),
      level: t.level || undefined,
      hidden: t.hidden === '1' || undefined,
      text: htmlToText(html),
      files: inline.files,
      links: inline.links,
      url: `${BASE}/mod/book/view.php?id=${cm.id}&chapterid=${id}`,
    });
  });
  return { chapters };
}

export async function label(ctx, cm, mod) {
  const inline = htmlLinks(mod?.description);
  return compact({ text: htmlToText(mod?.description), files: inline.files, links: inline.links });
}

export async function resource(ctx, cm, mod) {
  return compact({ files: mapFiles(mod?.contents) });
}

export const imscp = resource;

export async function folder(ctx, cm, mod) {
  return compact({ files: mapFiles(mod?.contents), zip: `${BASE}/mod/folder/download_folder.php?id=${cm.id}` });
}

export async function url(ctx, cm, mod) {
  const target = mod?.contents?.find((c) => c.type === 'url')?.fileurl
    ?? (await instanceOf(ctx, 'mod_url_get_urls_by_courses', 'urls', cm))?.externalurl;
  if (!target) return {};
  const out = { target };
  if (isPadletUrl(target)) {
    try { out.padlet = await ctx.padlet.getWall(target); } catch (e) { out.padletError = e.message; }
  }
  return out;
}
