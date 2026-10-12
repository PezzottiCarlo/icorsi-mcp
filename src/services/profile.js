// My profile: account data, private files, badges, groups, policies and every post I wrote in the forums.

import { compact, decode, toIso } from '../util/text.js';
import { publicFileUrl } from '../util/url.js';
import { getCourses } from './courses.js';
import { mapPost } from './modules/forum.js';

const MAX_DEPTH = 5;

// The private files area, one folder per core_files_get_files call
async function privateFiles(ctx, me, filepath = '/', depth = 0) {
  const r = await ctx.ws.call('core_files_get_files', { contextid: -1, contextlevel: 'user', instanceid: me, component: 'user', filearea: 'private', itemid: 0, filepath, filename: '' });
  const out = [];
  for (const f of r.files ?? []) {
    if (f.isdir) {
      const sub = f.filepath.endsWith(`/${f.filename}/`) ? f.filepath : `${f.filepath}${f.filename}/`;
      if (depth < MAX_DEPTH) out.push(...await privateFiles(ctx, me, sub, depth + 1));
    } else {
      out.push(compact({ name: f.filename, folder: f.filepath !== '/' ? f.filepath : undefined, url: publicFileUrl(f.url), size: f.filesize, modified: toIso(f.timemodified) }));
    }
  }
  return out;
}

/** Every post I wrote, from all the forums of my courses (website AJAX, one request) */
export async function getMyForumPosts(ctx) {
  const [me, courses] = await Promise.all([ctx.userId(), getCourses(ctx)]);
  if (!courses.length) return [];
  const forums = await ctx.ws.call('mod_forum_get_forums_by_courses', { courseids: courses.map((c) => c.id) });
  const res = await ctx.web.batch(forums.map((f) => ({ fn: 'mod_forum_get_discussion_posts_by_userid', args: { userid: me, cmid: f.cmid, sortby: 'created', sortdirection: 'DESC' } })));
  return res.flatMap((r, i) => (r.data?.discussions ?? []).flatMap((d) => (d.posts?.userposts ?? []).map((p) => ({
    ...mapPost(p),
    discussion: decode(d.name),
    forum: decode(forums[i].name),
    course: forums[i].course,
  }))));
}

export async function getProfile(ctx) {
  const [site, me] = await Promise.all([ctx.siteInfo(), ctx.userId()]);
  const [user, info, badges, policies, groups] = await ctx.ws.batch([
    { fn: 'core_user_get_users_by_field', args: { field: 'id', values: [me] } },
    { fn: 'core_user_get_private_files_info', args: {} },
    { fn: 'core_badges_get_user_badges', args: {} },
    { fn: 'tool_policy_get_user_acceptances', args: {} },
    { fn: 'core_group_get_course_user_groups', args: { courseid: 0, userid: me } },
  ]);
  const errors = [];
  const [files, forumPosts] = await Promise.all([
    privateFiles(ctx, me).catch((e) => { errors.push(`private files: ${e.message}`); }),
    getMyForumPosts(ctx).catch((e) => { errors.push(`forum posts: ${e.message}`); }),
  ]);
  const u = user.data?.[0] ?? {};
  return compact({
    id: me,
    fullname: u.fullname ?? site.fullname,
    username: site.username,
    email: u.email,
    department: u.department,
    institution: u.institution,
    idnumber: u.idnumber,
    lang: site.lang,
    quota: { used: info.data?.filesize ?? null, max: site.userquota ?? null },
    privateFiles: files,
    badges: badges.data?.badges?.map((b) => compact({ name: decode(b.name), issued: toIso(b.dateissued), issuer: b.issuername })),
    policies: policies.data?.policies?.map((p) => compact({ name: decode(p.name), status: p.acceptance?.status ?? p.status })),
    groups: groups.data?.groups?.map((g) => ({ name: decode(g.name), course: g.courseid })),
    forumPosts,
    errors,
  });
}
