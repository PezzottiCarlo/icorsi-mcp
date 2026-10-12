// Dashboard in one batched request: me, my courses, deadlines, unread counters, recent activities.

import { enrolledArgs, slimCourse, slimRecent } from './courses.js';
import { slimEvent, timelineArgs } from './calendar.js';

const must = (r) => {
  if (r.error) throw r.error;
  return r.data;
};

export async function getHome(ctx, { days = 7, now = new Date() } = {}) {
  const [site, me] = await Promise.all([ctx.siteInfo(), ctx.userId()]);
  const [courses, events, notifications, conversations, recent] = await ctx.ws.batch([
    { fn: 'core_course_get_enrolled_courses_by_timeline_classification', args: enrolledArgs('all') },
    { fn: 'core_calendar_get_action_events_by_timesort', args: timelineArgs({ days, now }) },
    { fn: 'message_popup_get_unread_popup_notification_count', args: { useridto: me } },
    { fn: 'core_message_get_unread_conversations_count', args: { useridto: me } },
    { fn: 'block_recentlyaccesseditems_get_recent_items', args: { limit: 5 } },
  ]);
  return {
    user: { id: me, fullname: site.fullname, username: site.username, lang: site.lang },
    courses: must(courses).courses.map(slimCourse),
    timeline: must(events).events.map(slimEvent),
    unread: { notifications: notifications.data ?? null, conversations: conversations.data ?? null },
    recent: (recent.data ?? []).map(slimRecent),
  };
}
