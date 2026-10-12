// Calendar: deadlines (timeline), month, day and upcoming views, single events.

import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';

export const slimEvent = (e) => compact({
  id: e.id,
  name: decode(e.name),
  description: htmlToText(e.description, { max: 2000 }),
  location: e.location || undefined,
  type: e.eventtype,
  module: e.modulename || undefined,
  activity: decode(e.activityname) || undefined,
  action: decode(e.action?.name) || undefined,
  date: toIso(e.timestart),
  duration: e.timeduration || undefined,
  overdue: e.overdue || undefined,
  url: e.url ?? e.viewurl,
  course: e.course && { id: e.course.id, fullname: decode(e.course.fullname) },
});

// multi-day events appear on each day of the month view
const unique = (events) => {
  const seen = new Set();
  return events.filter((e) => !seen.has(e.id) && seen.add(e.id));
};

/** Deadlines from today's midnight to `days` days later (the dashboard "Timeline" block) */
export function timelineArgs({ days = 7, limit = 50, now = new Date() } = {}) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const timesortfrom = Math.floor(from / 1000);
  return { timesortfrom, timesortto: timesortfrom + days * 86400, limitnum: limit, limittononsuspendedevents: true };
}

export async function getTimeline(ctx, opts = {}) {
  const r = await ctx.ws.call('core_calendar_get_action_events_by_timesort', timelineArgs(opts));
  return r.events.map(slimEvent);
}

/** courseId 1 = all courses */
export async function getCalendarMonth(ctx, { year, month, courseId = 1, now = new Date() } = {}) {
  const y = Number(year ?? now.getFullYear());
  const m = Number(month ?? now.getMonth() + 1);
  const r = await ctx.ws.call('core_calendar_get_calendar_monthly_view', { year: y, month: m, courseid: Number(courseId), day: 1 });
  const events = unique(r.weeks.flatMap((w) => w.days).flatMap((d) => d.events));
  return { year: y, month: m, period: r.periodname, events: events.map(slimEvent) };
}

export async function getCalendarDay(ctx, { year, month, day, courseId = 1, now = new Date() } = {}) {
  const args = {
    year: Number(year ?? now.getFullYear()),
    month: Number(month ?? now.getMonth() + 1),
    day: Number(day ?? now.getDate()),
    courseid: Number(courseId),
  };
  const r = await ctx.ws.call('core_calendar_get_calendar_day_view', args);
  const pad = (n) => String(n).padStart(2, '0');
  return { date: `${args.year}-${pad(args.month)}-${pad(args.day)}`, period: r.periodname, events: r.events.map(slimEvent) };
}

export async function getUpcoming(ctx, { courseId = 1 } = {}) {
  const r = await ctx.ws.call('core_calendar_get_calendar_upcoming_view', { courseid: Number(courseId), categoryid: 0 });
  return { events: r.events.map(slimEvent) };
}

export async function getCalendarEvent(ctx, eventId) {
  const r = await ctx.ws.call('core_calendar_get_calendar_event_by_id', { eventid: Number(eventId) });
  return slimEvent(r.event);
}
