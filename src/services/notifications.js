// Popup notifications: content changes, forum posts, grades, deadlines.

import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';

export function slimNotification(n) {
  let course;
  try { course = Number(JSON.parse(n.customdata ?? '{}').courseid) || undefined; } catch { /* no course attached */ }
  return compact({
    id: n.id,
    subject: decode(n.subject),
    text: htmlToText(n.fullmessagehtml || n.text).replace(/\s*Change your notification preferences\s*$/i, ''),
    url: n.contexturl ?? undefined,
    context: decode(n.contexturlname) ?? undefined,
    type: n.eventtype,
    read: n.read,
    date: toIso(n.timecreated),
    course,
  });
}

export async function getNotifications(ctx, { limit = 20, offset = 0, unreadOnly = false } = {}) {
  const r = await ctx.ws.call('message_popup_get_popup_notifications', { useridto: await ctx.userId(), limit, offset, newestfirst: 1 });
  const list = r.notifications.map(slimNotification);
  return { unread: r.unreadcount, notifications: unreadOnly ? list.filter((n) => !n.read) : list };
}
