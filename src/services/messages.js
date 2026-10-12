// Private messages: conversations, their messages, contacts and contact requests.

import { compact, decode, toIso } from '../util/text.js';
import { htmlToText } from '../util/html.js';

const TYPES = { 1: 'private', 2: 'group', 3: 'self' };

const slimMessage = (m, names) => compact({
  id: m.id,
  from: names.get(m.useridfrom) ?? String(m.useridfrom),
  text: htmlToText(m.text),
  date: toIso(m.timecreated),
});

export async function getConversations(ctx) {
  const me = await ctx.userId();
  const [convs, contacts, requests] = await ctx.ws.batch([
    { fn: 'core_message_get_conversations', args: { userid: me, limitfrom: 0, limitnum: 100, mergeself: true } },
    { fn: 'core_message_get_user_contacts', args: { userid: me, limitfrom: 0, limitnum: 100 } },
    { fn: 'core_message_get_contact_requests', args: { userid: me } },
  ]);
  if (convs.error) throw convs.error;
  return compact({
    conversations: convs.data.conversations.map((c) => {
      const members = c.members ?? [];
      const others = members.filter((m) => m.id !== me).map((m) => m.fullname).join(', ');
      return compact({
        id: c.id,
        type: TYPES[c.type] ?? String(c.type),
        name: decode(c.name) || others || (c.type === 3 ? 'Personal space' : 'Conversation'),
        members: c.membercount,
        unread: c.unreadcount || undefined,
        favourite: c.isfavourite || undefined,
        muted: c.ismuted || undefined,
        last: c.messages?.[0] && slimMessage(c.messages[0], new Map(members.map((m) => [m.id, m.fullname]))),
      });
    }),
    contacts: (contacts.data ?? []).map((u) => u.fullname),
    contactRequests: (requests.data ?? []).map((u) => u.fullname),
  });
}

export async function getConversation(ctx, conversationId, { limit = 100 } = {}) {
  const r = await ctx.ws.call('core_message_get_conversation_messages', { currentuserid: await ctx.userId(), convid: Number(conversationId), limitfrom: 0, limitnum: limit, newest: true });
  const names = new Map(r.members.map((m) => [m.id, m.fullname]));
  return { id: r.id, members: r.members.map((m) => m.fullname), messages: r.messages.map((m) => slimMessage(m, names)).reverse() };
}
