import test from 'node:test';
import assert from 'node:assert/strict';
import { slimEvent, getTimeline, getCalendarMonth, getCalendarDay, getUpcoming, getCalendarEvent } from '../src/services/calendar.js';
import { getNotifications } from '../src/services/notifications.js';
import { getConversations, getConversation } from '../src/services/messages.js';
import { getGradesOverview, getCourseGrades } from '../src/services/grades.js';
import { getParticipants } from '../src/services/participants.js';
import { getProfile } from '../src/services/profile.js';
import { getHome } from '../src/services/home.js';
import { fakeCtx } from './helpers.js';

const ev = (id, extra = {}) => ({
  id, name: 'Consegna &#34;A&#34; is due', description: '<p>Ricorda</p>', location: '', eventtype: 'due', modulename: 'assign', activityname: 'Consegna',
  timestart: 1794178740, timeduration: 0, overdue: false, url: 'https://www.icorsi.ch/mod/assign/view.php?id=1',
  course: { id: 9, fullname: 'Grandezze &amp; misure' }, action: { name: 'Add submission' }, ...extra,
});

test('slimEvent', () => {
  assert.deepEqual(slimEvent(ev(1)), {
    id: 1, name: 'Consegna "A" is due', description: 'Ricorda', type: 'due', module: 'assign', activity: 'Consegna', action: 'Add submission',
    date: '2026-11-08T22:59:00.000Z', url: 'https://www.icorsi.ch/mod/assign/view.php?id=1', course: { id: 9, fullname: 'Grandezze & misure' },
  });
});

test('getTimeline asks for the next N days from midnight', async () => {
  const ctx = fakeCtx({ ws: { core_calendar_get_action_events_by_timesort: { events: [ev(1)] } } });
  assert.equal((await getTimeline(ctx, { days: 3, now: new Date('2026-10-12T15:00:00') })).length, 1);
  const args = ctx.calls[0].args;
  assert.equal(args.timesortto - args.timesortfrom, 3 * 86400);
  assert.equal(new Date(args.timesortfrom * 1000).getHours(), 0);
  assert.equal(args.limittononsuspendedevents, true);
});

test('getCalendarMonth dedupes multi-day events', async () => {
  const ctx = fakeCtx({ ws: { core_calendar_get_calendar_monthly_view: { periodname: 'October 2026', weeks: [{ days: [{ events: [ev(1)] }, { events: [ev(1), ev(2)] }] }] } } });
  const m = await getCalendarMonth(ctx, { year: 2026, month: 10 });
  assert.deepEqual({ ...m, events: m.events.map((e) => e.id) }, { year: 2026, month: 10, period: 'October 2026', events: [1, 2] });
  assert.deepEqual(ctx.calls[0].args, { year: 2026, month: 10, courseid: 1, day: 1 });
});

test('getCalendarDay, getUpcoming and getCalendarEvent', async () => {
  const ctx = fakeCtx({ ws: {
    core_calendar_get_calendar_day_view: { periodname: 'Tuesday, 6 October 2026', events: [ev(3)] },
    core_calendar_get_calendar_upcoming_view: { events: [ev(4)] },
    core_calendar_get_calendar_event_by_id: { event: ev(5) },
  } });
  const day = await getCalendarDay(ctx, { year: 2026, month: 10, day: 6 });
  assert.equal(day.date, '2026-10-06');
  assert.deepEqual(day.events.map((e) => e.id), [3]);
  assert.deepEqual((await getUpcoming(ctx)).events.map((e) => e.id), [4]);
  assert.equal((await getCalendarEvent(ctx, 5)).id, 5);
});

test('getNotifications maps and filters unread', async () => {
  const n = (id, read) => ({
    id, subject: 'Psicologia 1 content change', fullmessagehtml: '<p>Board <a href="https://www.icorsi.ch/mod/board/view.php?id=1">Tabella</a> has been changed.</p><p><a href="x">Change your notification preferences</a></p>',
    contexturl: 'https://www.icorsi.ch/mod/board/view.php?id=1', contexturlname: 'Tabella', eventtype: 'coursecontentupdated', component: 'moodle', read, timecreated: 1791795443, customdata: '{"courseid":"24532"}',
  });
  const ctx = fakeCtx({ ws: { message_popup_get_popup_notifications: { notifications: [n(1, false), n(2, true)], unreadcount: 1 } } });
  assert.deepEqual(await getNotifications(ctx, { unreadOnly: true }), { unread: 1, notifications: [{
    id: 1, subject: 'Psicologia 1 content change', text: 'Board Tabella has been changed.', url: 'https://www.icorsi.ch/mod/board/view.php?id=1', context: 'Tabella',
    type: 'coursecontentupdated', read: false, date: '2026-10-12T08:57:23.000Z', course: 24532,
  }] });
  assert.deepEqual(ctx.calls[0].args, { useridto: 7, limit: 20, offset: 0, newestfirst: 1 });
});

test('getConversations lists conversations, contacts and requests', async () => {
  const ctx = fakeCtx({ ws: {
    core_message_get_conversations: { conversations: [
      { id: 125405, name: '', type: 3, membercount: 1, unreadcount: null, isfavourite: true, ismuted: false, members: [{ id: 7, fullname: 'Test Student' }], messages: [] },
      { id: 200, name: '', type: 1, membercount: 2, unreadcount: 2, isfavourite: false, ismuted: false, members: [{ id: 3, fullname: 'Paolo Arru' }], messages: [{ id: 9, useridfrom: 3, text: '<p>Ciao</p>', timecreated: 1791795443 }] },
    ] },
    core_message_get_user_contacts: [{ id: 3, fullname: 'Paolo Arru' }],
    core_message_get_contact_requests: [],
  } });
  assert.deepEqual(await getConversations(ctx), {
    conversations: [
      { id: 125405, type: 'self', name: 'Personal space', members: 1, favourite: true },
      { id: 200, type: 'private', name: 'Paolo Arru', members: 2, unread: 2, last: { id: 9, from: 'Paolo Arru', text: 'Ciao', date: '2026-10-12T08:57:23.000Z' } },
    ],
    contacts: ['Paolo Arru'],
  });
});

test('getConversation returns messages oldest first', async () => {
  const ctx = fakeCtx({ ws: { core_message_get_conversation_messages: { id: 200, members: [{ id: 3, fullname: 'Paolo Arru' }, { id: 7, fullname: 'Test Student' }], messages: [
    { id: 2, useridfrom: 7, text: '<p>Grazie</p>', timecreated: 1791795443 },
    { id: 1, useridfrom: 3, text: '<p>Ciao</p>', timecreated: 1791395156 },
  ] } } });
  const c = await getConversation(ctx, 200);
  assert.deepEqual(c.messages.map((m) => [m.id, m.from, m.text]), [[1, 'Paolo Arru', 'Ciao'], [2, 'Test Student', 'Grazie']]);
  assert.deepEqual(c.members, ['Paolo Arru', 'Test Student']);
  assert.deepEqual(ctx.calls[0].args, { currentuserid: 7, convid: 200, limitfrom: 0, limitnum: 100, newest: true });
});

test('getGradesOverview names the courses', async () => {
  const ctx = fakeCtx({ ws: {
    gradereport_overview_get_course_grades: { grades: [{ courseid: 9, grade: '-', rawgrade: null }, { courseid: 10, grade: '5.5', rawgrade: '5.50000' }] },
    core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 9, fullname: 'Pedagogia' }, { id: 10, fullname: 'Psicologia' }] },
  } });
  assert.deepEqual(await getGradesOverview(ctx), [
    { course: { id: 9, fullname: 'Pedagogia' }, grade: null },
    { course: { id: 10, fullname: 'Psicologia' }, grade: '5.5', raw: 5.5 },
  ]);
});

test('getCourseGrades lists every grade item', async () => {
  const ctx = fakeCtx({ ws: { gradereport_user_get_grade_items: { usergrades: [{ gradeitems: [
    { itemname: 'Consegna documento', itemtype: 'mod', itemmodule: 'assign', cmid: 50, gradeformatted: '85.00', rangeformatted: '0&ndash;100', percentageformatted: '85.00 %', feedback: '<p>Bene</p>', gradedategraded: 1791795443, gradedatesubmitted: 1791395156, gradeishidden: false },
    { itemname: null, itemtype: 'course', gradeformatted: '-', rangeformatted: '0&ndash;100', percentageformatted: '-', feedback: '' },
  ] }] } } });
  assert.deepEqual(await getCourseGrades(ctx, 23547), { course: 23547, items: [
    { name: 'Consegna documento', type: 'mod', module: 'assign', cmid: 50, grade: '85.00', range: '0–100', percentage: '85.00 %', feedback: 'Bene', graded: '2026-10-12T08:57:23.000Z', submitted: '2026-10-07T17:45:56.000Z' },
    { name: 'Course total', type: 'course', grade: null, range: '0–100', percentage: null },
  ] });
  assert.deepEqual(ctx.calls[0].args, { courseid: 23547, userid: 7 });
});

test('getParticipants lists people with roles and groups, filterable by role', async () => {
  const ctx = fakeCtx({ ws: {
    core_enrol_get_enrolled_users: [
      { id: 3, fullname: 'Paolo Arru', email: 'paolo@example.org', roles: [{ shortname: 'editingteacher' }], groups: [] },
      { id: 7, fullname: 'Test Student', roles: [{ shortname: 'student' }], groups: [{ name: 'Group A' }] },
    ],
    core_group_get_course_user_groups: { groups: [{ id: 1, name: 'Group A', courseid: 9 }] },
  } });
  assert.deepEqual(await getParticipants(ctx, 9, { role: 'editingteacher' }), {
    course: 9, total: 2, myGroups: ['Group A'],
    participants: [{ id: 3, fullname: 'Paolo Arru', email: 'paolo@example.org', roles: ['editingteacher'] }],
  });
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'core_enrol_get_enrolled_users').args, { courseid: 9, options: [{ name: 'userfields', value: 'id,fullname,email,roles,groups' }] });
});

test('getProfile gathers user, files, badges, groups and my forum posts', async () => {
  const ctx = fakeCtx({
    ws: {
      core_user_get_users_by_field: [{ id: 7, fullname: 'Test Student', email: 'me@example.org', department: 'DFA', institution: 'SUPSI', idnumber: '21-1' }],
      core_user_get_private_files_info: { filecount: 1, filesize: 2048 },
      core_files_get_files: ({ filepath }) => (filepath === '/'
        ? { files: [{ filename: 'notes', filepath: '/', isdir: true }, { filename: 'cv.pdf', filepath: '/', isdir: false, url: 'https://www.icorsi.ch/webservice/pluginfile.php/5/user/private/0/cv.pdf', filesize: 2048, timemodified: 1791395156 }] }
        : { files: [] }),
      core_badges_get_user_badges: { badges: [{ name: 'Benvenuto', dateissued: 1791395156, issuername: 'iCorsi' }] },
      tool_policy_get_user_acceptances: { policies: [] },
      core_group_get_course_user_groups: { groups: [{ name: 'Group B', courseid: 23559 }] },
      core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 9, fullname: 'Pedagogia' }] },
      mod_forum_get_forums_by_courses: [{ id: 1, cmid: 50, course: 9, name: 'Forum di discussione' }],
    },
    web: {
      mod_forum_get_discussion_posts_by_userid: { discussions: [{ id: 5, name: 'Domanda', posts: { userposts: [{ id: 99, subject: 'Domanda', message: '<p>Come si fa?</p>', author: { fullname: 'Test Student' }, discussionid: 5, timecreated: 1791395156, timemodified: 1791395156, attachments: [] }] } }] },
    },
  });
  const p = await getProfile(ctx);
  assert.equal(p.fullname, 'Test Student');
  assert.equal(p.email, 'me@example.org');
  assert.deepEqual(p.quota, { used: 2048, max: 1000 });
  assert.deepEqual(p.privateFiles, [{ name: 'cv.pdf', url: 'https://www.icorsi.ch/pluginfile.php/5/user/private/0/cv.pdf', size: 2048, modified: '2026-10-07T17:45:56.000Z' }]);
  assert.deepEqual(p.badges, [{ name: 'Benvenuto', issued: '2026-10-07T17:45:56.000Z', issuer: 'iCorsi' }]);
  assert.deepEqual(p.groups, [{ name: 'Group B', course: 23559 }]);
  assert.deepEqual(p.forumPosts.map((x) => [x.id, x.discussion, x.forum, x.course, x.text]), [[99, 'Domanda', 'Forum di discussione', 9, 'Come si fa?']]);
  assert.deepEqual(ctx.calls.find((c) => c.fn === 'mod_forum_get_discussion_posts_by_userid').args, { userid: 7, cmid: 50, sortby: 'created', sortdirection: 'DESC' });
  assert.deepEqual(ctx.calls.filter((c) => c.fn === 'core_files_get_files').map((c) => c.args.filepath), ['/', '/notes/']);
  assert.equal(p.policies, undefined);
  assert.equal(p.errors, undefined);
});

test('getHome gathers everything in one batch', async () => {
  const ctx = fakeCtx({ ws: {
    core_course_get_enrolled_courses_by_timeline_classification: { courses: [{ id: 9, fullname: 'Pedagogia', viewurl: 'u9' }] },
    core_calendar_get_action_events_by_timesort: { events: [{ id: 1, name: 'Consegna', eventtype: 'due', timestart: 1794178740, url: 'x' }] },
    message_popup_get_unread_popup_notification_count: 3,
    core_message_get_unread_conversations_count: 1,
    block_recentlyaccesseditems_get_recent_items: [{ cmid: 50, name: 'Quiz', modname: 'quiz', timeaccess: 1791795443 }],
  } });
  const h = await getHome(ctx, { days: 7 });
  assert.deepEqual(h.user, { id: 7, fullname: 'Test Student', username: 'test@example.org', lang: 'it' });
  assert.deepEqual(h.courses, [{ id: 9, fullname: 'Pedagogia', url: 'u9' }]);
  assert.equal(h.timeline[0].name, 'Consegna');
  assert.deepEqual(h.unread, { notifications: 3, conversations: 1 });
  assert.equal(h.recent[0].id, 50);
});
