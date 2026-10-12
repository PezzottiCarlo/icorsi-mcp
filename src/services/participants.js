// People enrolled in a course (what the Participants page shows) and my groups there.

import { compact, decode } from '../util/text.js';

export async function getParticipants(ctx, courseId, { role } = {}) {
  const id = Number(courseId);
  const [users, mine] = await ctx.ws.batch([
    { fn: 'core_enrol_get_enrolled_users', args: { courseid: id, options: [{ name: 'userfields', value: 'id,fullname,email,roles,groups' }] } },
    { fn: 'core_group_get_course_user_groups', args: { courseid: id, userid: await ctx.userId() } },
  ]);
  if (users.error) throw users.error;
  const people = users.data.map((u) => compact({
    id: u.id,
    fullname: u.fullname,
    email: u.email,
    roles: (u.roles ?? []).map((r) => r.shortname),
    groups: (u.groups ?? []).map((g) => decode(g.name)),
  }));
  return compact({
    course: id,
    total: people.length,
    myGroups: (mine.data?.groups ?? []).map((g) => decode(g.name)),
    participants: role ? people.filter((p) => p.roles?.includes(role)) : people,
  });
}
