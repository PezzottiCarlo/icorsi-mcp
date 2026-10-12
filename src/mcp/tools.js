// MCP tool definitions. Every tool only reads iCorsi; new_content, download and login write local files.

import { z } from 'zod';

const READ = { readOnlyHint: true, openWorldHint: true };
const LOCAL = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export const TOOL_NAMES = [
  'icorsi_home', 'icorsi_list_courses', 'icorsi_get_course', 'icorsi_get_activity', 'icorsi_quiz_review',
  'icorsi_search_courses', 'icorsi_calendar', 'icorsi_new_content', 'icorsi_find', 'icorsi_download',
  'icorsi_notifications', 'icorsi_messages', 'icorsi_grades', 'icorsi_profile', 'icorsi_participants',
  'icorsi_recent', 'icorsi_api', 'icorsi_login',
];

export function registerTools(server, api) {
  const tool = (name, description, inputSchema, handler, annotations = READ) => {
    server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
      try {
        return { content: [{ type: 'text', text: JSON.stringify(await handler(args ?? {})) }] };
      } catch (e) {
        return { isError: true, content: [{ type: 'text', text: e.message }] };
      }
    });
  };

  tool('icorsi_home',
    'iCorsi dashboard: the logged-in user, enrolled courses, deadlines of the next days, unread notifications and messages, recently opened activities. Start here.',
    { days: z.number().int().min(1).max(365).optional().describe('How many days ahead to look for deadlines (default 7)') },
    ({ days }) => api.getHome({ days }));

  tool('icorsi_list_courses',
    'Courses the user is enrolled in, with ids, category, dates and progress.',
    { classification: z.enum(['all', 'inprogress', 'future', 'past', 'favourites', 'hidden']).optional() },
    ({ classification }) => api.getCourses({ classification }));

  tool('icorsi_get_course',
    'One course: details, teachers and every section with its activities. Files, links, label text, dates and completion are included. '
    + 'Pass an activity id (cmid) to icorsi_get_activity for its full content.',
    { course_id: z.number().int() },
    ({ course_id }) => api.getCourse(course_id));

  tool('icorsi_get_activity',
    'Everything inside one activity, by url or cmid: page and book text, files, links, forum discussions with every post, assignment dates, submission, grade and feedback, '
    + 'quiz attempts, board notes, glossary entries, wiki pages, feedback questions, group choices, the posts of a Padlet behind a link... '
    + 'A forum discussion url (discuss.php?d=) returns that discussion. Reading never marks the activity as viewed.',
    {
      url: z.string().url().optional().describe('Activity url (/mod/<type>/view.php?id=...) or forum discussion url'),
      cmid: z.number().int().optional().describe('Activity id (cmid), as listed by icorsi_get_course'),
    },
    ({ url, cmid }) => {
      if (!url && !cmid) throw new Error('Pass url or cmid');
      return api.getActivity(cmid ? { cmid } : { url });
    });

  tool('icorsi_quiz_review',
    'Review of a finished quiz attempt: every question with my answer, its outcome, marks and feedback. Attempt ids come from icorsi_get_activity on a quiz.',
    { attempt_id: z.number().int() },
    ({ attempt_id }) => api.getQuizReview(attempt_id));

  tool('icorsi_search_courses',
    'Search the whole iCorsi course catalogue (also courses the user is not enrolled in): teachers, category, enrolment methods.',
    { query: z.string().min(1), page: z.number().int().min(0).optional() },
    ({ query, page }) => api.searchCourses(query, { page }));

  tool('icorsi_calendar',
    'Calendar events (deadlines, course events). view: month (default, current month), day, or upcoming.',
    {
      view: z.enum(['month', 'day', 'upcoming']).optional(),
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
      day: z.number().int().min(1).max(31).optional(),
      course_id: z.number().int().optional().describe('Only events of this course (default: all courses)'),
    },
    ({ view = 'month', year, month, day, course_id }) => {
      const courseId = course_id ?? 1;
      if (view === 'upcoming') return api.getUpcoming({ courseId });
      if (view === 'day') return api.getCalendarDay({ year, month, day, courseId });
      return api.getCalendarMonth({ year, month, courseId });
    });

  tool('icorsi_new_content',
    'What is new in the enrolled courses: activities, files, links, book chapters, forum discussions and posts. '
    + 'Without `since` it compares with the previous scan (a course seen for the first time only records a baseline). '
    + 'With `since` (ISO date) it lists what changed after that date, no previous scan needed. Takes a few seconds.',
    {
      course_id: z.number().int().optional().describe('Only this course (default: all enrolled courses)'),
      since: z.string().optional().describe('ISO date, e.g. 2026-10-11 or 2026-10-11T08:00:00Z'),
      mark_seen: z.boolean().optional().describe('Default true. false = peek: the same items are reported again next time'),
    },
    ({ course_id, since, mark_seen }) => api.findNewContent({ courseId: course_id, since, markSeen: mark_seen }),
    LOCAL);

  tool('icorsi_find',
    'Search by words across everything inside the enrolled courses: activity names and text, files (also inside folders), links, book chapters, forum discussions and posts. '
    + 'Uses the index of the last icorsi_new_content scan (see lastScan); the first call builds it.',
    {
      query: z.string().min(1).describe('Words that must all appear (case and accent insensitive)'),
      course_id: z.number().int().optional(),
      kind: z.enum(['activity', 'file', 'link', 'discussion', 'post', 'page']).optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
    ({ query, course_id, kind, limit }) => api.searchContent(query, { courseId: course_id, kind, limit }));

  tool('icorsi_download',
    'Download to the local disk and return the path: a file url (pluginfile.php), a File activity url, a folder activity url (as zip) '
    + 'or https://www.icorsi.ch/mod/folder/download_folder.php?id=<cmid>.',
    { url: z.string().url(), dir: z.string().optional().describe('Destination directory (default: the server download directory)') },
    ({ url, dir }) => api.download(url, dir ? { dir } : {}),
    LOCAL);

  tool('icorsi_notifications',
    'Notifications (content changes, forum posts, grades, deadlines...) with link, course and read state.',
    { limit: z.number().int().min(1).max(100).optional(), unread_only: z.boolean().optional() },
    ({ limit, unread_only }) => api.getNotifications({ limit, unreadOnly: unread_only }));

  tool('icorsi_messages',
    'Private messages. Without conversation_id: conversations with unread counts and last message, contacts and contact requests. '
    + 'With conversation_id: its messages, oldest first.',
    { conversation_id: z.number().int().optional(), limit: z.number().int().min(1).max(500).optional() },
    ({ conversation_id, limit }) => (conversation_id ? api.getConversation(conversation_id, { limit }) : api.getConversations()));

  tool('icorsi_grades',
    'Grades. Without course_id: the total of every course. With course_id: every grade item with grade, range, percentage and feedback.',
    { course_id: z.number().int().optional() },
    ({ course_id }) => api.getGrades({ courseId: course_id }));

  tool('icorsi_profile',
    'My profile: name, email, department, quota, private files, badges, groups, site policies and every post I wrote in the forums.',
    {},
    () => api.getProfile());

  tool('icorsi_participants',
    'People enrolled in a course with their roles and groups, plus my groups there. role filters by role shortname (student, teacher, editingteacher...).',
    { course_id: z.number().int(), role: z.string().optional() },
    ({ course_id, role }) => api.getParticipants(course_id, { role }));

  tool('icorsi_recent',
    'Activities I opened most recently, newest first.',
    { limit: z.number().int().min(1).max(50).optional() },
    ({ limit }) => api.getRecentItems({ limit }));

  tool('icorsi_api',
    'Advanced: call any read-only Moodle web service function directly (the mobile app API, 400+ functions such as core_course_get_contents, '
    + 'mod_forum_get_forum_discussions, gradereport_user_get_grades_table). Only reads are allowed (names with _get_, _search_, _list_...). '
    + 'transport=ajax uses the website AJAX service instead (needed for mod_board_* and mod_forum_get_discussion_posts_by_userid).',
    {
      function: z.string().min(3),
      args: z.record(z.string(), z.unknown()).optional(),
      transport: z.enum(['ws', 'ajax']).optional(),
    },
    ({ function: fn, args, transport }) => api.call(fn, args ?? {}, { transport }));

  tool('icorsi_login',
    'Force a new login. Normally not needed: every tool logs in by itself, opening a browser window for the Microsoft login only when required.',
    {},
    () => api.login(),
    LOCAL);
}
