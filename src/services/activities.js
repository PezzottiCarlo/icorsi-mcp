// One activity in depth: resolves the course module, then asks the handler of its type.

import { BASE } from '../config.js';
import { IcorsiError } from '../errors.js';
import { compact, decode } from '../util/text.js';
import { htmlToText, htmlLinks } from '../util/html.js';
import { cmidFromUrl, discussionIdFromUrl, fileKey, isFileUrl } from '../util/url.js';
import { completionOf, datesOf } from './common.js';
import { rawContents } from './courses.js';
import { HANDLERS, generic } from './modules/index.js';
import { getDiscussion } from './modules/forum.js';

const toRef = (ref) => {
  if (typeof ref === 'number' || /^\d+$/.test(String(ref))) return { cmid: Number(ref) };
  return typeof ref === 'string' ? { url: ref } : ref ?? {};
};

const dedupe = (list, key) => {
  const seen = new Set();
  return list.filter((x) => !seen.has(key(x)) && seen.add(key(x)));
};

/** { cmid } or { url } -> the course module, its entry in the course contents and its section */
export async function resolveModule(ctx, { cmid, url } = {}) {
  const id = Number(cmid) || (url ? cmidFromUrl(url) : null);
  if (!id) throw new IcorsiError(`Not an activity: ${url ?? cmid} (expected /mod/<type>/view.php?id=<cmid>)`);
  const { cm } = await ctx.cache.get(`cm:${id}`, () => ctx.ws.call('core_course_get_course_module', { cmid: id }));
  for (const s of await rawContents(ctx, cm.course)) {
    const mod = (s.modules ?? []).find((m) => m.id === cm.id);
    if (mod) return { cm, mod, section: decode(s.name) };
  }
  return { cm, mod: null, section: null };
}

export async function getActivity(ctx, ref) {
  ref = toRef(ref);
  if (ref.url && isFileUrl(ref.url)) throw new IcorsiError('That is a file: download it with icorsi_download');
  const discussionId = ref.url ? discussionIdFromUrl(ref.url) : null;
  if (discussionId) return getDiscussion(ctx, discussionId);
  const { cm, mod, section } = await resolveModule(ctx, ref);
  const described = htmlLinks(mod?.description);
  const base = compact({
    id: cm.id,
    type: cm.modname,
    name: decode(cm.name),
    course: cm.course,
    section,
    url: mod?.url ?? `${BASE}/mod/${cm.modname}/view.php?id=${cm.id}`,
    description: cm.modname === 'label' ? undefined : htmlToText(mod?.description),
    completion: completionOf(mod),
    dates: datesOf(mod),
  });
  let extra;
  try {
    extra = await (HANDLERS[cm.modname] ?? generic)(ctx, cm, mod);
  } catch (e) {
    extra = { error: `Could not read the ${cm.modname} content: ${e.message}` };
  }
  return compact({
    ...base,
    ...extra,
    files: dedupe([...(extra.files ?? []), ...described.files], (f) => fileKey(f.url)),
    links: dedupe([...(extra.links ?? []), ...described.links], (l) => l.url),
  });
}
