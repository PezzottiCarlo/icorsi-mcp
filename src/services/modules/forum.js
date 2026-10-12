// Forums: every discussion with all its posts, and single discussions.

import { BASE } from '../../config.js';
import { compact, decode, toIso } from '../../util/text.js';
import { htmlToText, htmlLinks } from '../../util/html.js';
import { instanceOf, mapFiles } from '../common.js';

export const mapPost = (p) => compact({
  id: p.id,
  subject: decode(p.subject),
  author: p.author?.fullname,
  date: toIso(p.timecreated),
  edited: p.timemodified > p.timecreated ? toIso(p.timemodified) : undefined,
  parent: p.parentid ?? undefined,
  private: p.isprivatereply || undefined,
  text: htmlToText(p.message),
  files: mapFiles(p.attachments),
  links: htmlLinks(p.message).links,
  url: `${BASE}/mod/forum/discuss.php?d=${p.discussionid}#p${p.id}`,
});

export const mapDiscussion = (d) => compact({
  id: d.discussion,
  title: decode(d.name),
  author: d.userfullname,
  created: toIso(d.created),
  modified: toIso(d.timemodified),
  replies: d.numreplies,
  unread: d.numunread || undefined,
  pinned: d.pinned || undefined,
  locked: d.locked || undefined,
  url: `${BASE}/mod/forum/discuss.php?d=${d.discussion}`,
});

export const postsCall = (discussionid) => ({ fn: 'mod_forum_get_discussion_posts', args: { discussionid, sortby: 'created', sortdirection: 'ASC' } });

export async function getDiscussion(ctx, discussionId) {
  const { fn, args } = postsCall(Number(discussionId));
  const r = await ctx.ws.call(fn, args);
  return { type: 'discussion', id: Number(discussionId), forum: r.forumid, course: r.courseid, url: `${BASE}/mod/forum/discuss.php?d=${discussionId}`, posts: r.posts.map(mapPost) };
}

export async function forum(ctx, cm) {
  const [info, list] = await Promise.all([
    instanceOf(ctx, 'mod_forum_get_forums_by_courses', null, cm),
    ctx.ws.call('mod_forum_get_forum_discussions', { forumid: cm.instance }),
  ]);
  const discussions = list.discussions.map(mapDiscussion);
  const posts = await ctx.ws.batch(discussions.map((d) => postsCall(d.id)));
  discussions.forEach((d, i) => {
    if (posts[i].error) d.error = posts[i].error.message;
    else d.posts = posts[i].data.posts.map(mapPost);
  });
  return compact({ forumType: info?.type, intro: htmlToText(info?.intro), discussions });
}
