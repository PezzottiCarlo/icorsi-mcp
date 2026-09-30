// MCP server (stdio) exposing the unofficial iCorsi API to AI clients.
// stdout is the MCP channel: never console.log here, only console.error.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ICorsi } from './client.js';

const api = new ICorsi();
const server = new McpServer({ name: 'icorsi', version: '0.1.0' });

function tool(name, description, inputSchema, handler, annotations = { readOnlyHint: true }) {
  server.registerTool(name, { description, inputSchema, annotations }, async (args) => {
    try {
      return { content: [{ type: 'text', text: JSON.stringify(await handler(args), null, 2) }] };
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: e.message }] };
    }
  });
}

tool('icorsi_home',
  'iCorsi dashboard: the logged-in user, enrolled courses and upcoming deadlines (timeline). Start here.',
  { days: z.number().int().min(1).max(365).optional().describe('How many days ahead to look for deadlines (default 7)') },
  ({ days }) => api.getHome({ days }));

tool('icorsi_list_courses',
  'Courses the user is enrolled in, with their ids.',
  { classification: z.enum(['all', 'inprogress', 'future', 'past', 'favourites', 'hidden']).optional() },
  ({ classification }) => api.getCourses({ classification }));

tool('icorsi_get_course',
  'Sections and activities (files, folders, forums, assignments...) of a course. Each activity has a url to pass to icorsi_get_activity.',
  { course_id: z.number().int() },
  ({ course_id }) => api.getCourseContents(course_id));

tool('icorsi_get_activity',
  'Everything inside one activity: page text, downloadable files, external links, assignment dates and submission status, '
  + 'forum discussions with all posts and attachments, book chapters. Opening an activity may mark it as viewed on iCorsi.',
  { url: z.string().url().describe('Activity url, as returned by icorsi_get_course / icorsi_find / icorsi_new_content') },
  ({ url }) => api.getActivity(url),
  { readOnlyHint: false });

tool('icorsi_search_courses',
  'Search the whole iCorsi course catalogue (also courses the user is not enrolled in).',
  { query: z.string().min(1), page: z.number().int().min(0).optional() },
  ({ query, page }) => api.searchCourses(query, { page }));

tool('icorsi_calendar',
  'Calendar events (deadlines, course events) of a month. Defaults to the current month.',
  {
    year: z.number().int().optional(),
    month: z.number().int().min(1).max(12).optional(),
    course_id: z.number().int().optional().describe('Only events of this course (default: all courses)'),
  },
  ({ year, month, course_id }) => api.getCalendarMonth({ year, month, courseId: course_id }));

tool('icorsi_new_content',
  'Deep scan of the enrolled courses: goes inside every activity, folder, forum discussion and book and returns what is new '
  + 'since the previous scan (activities, files, links, discussions, posts). Slow: about a minute for all courses. '
  + 'A course scanned for the first time only records a baseline (baseline: true) and reports nothing new.',
  {
    course_id: z.number().int().optional().describe('Scan only this course (default: all enrolled courses)'),
    mark_seen: z.boolean().optional().describe('Default true. false = peek: the same items are reported again at the next scan'),
  },
  ({ course_id, mark_seen }) => api.findNewContent({ courseId: course_id, markSeen: mark_seen }),
  { readOnlyHint: false });

tool('icorsi_find',
  'Search by name across everything inside the enrolled courses: activities, files (also inside folders), links, forum '
  + 'discussions and posts. Uses the index built by the last icorsi_new_content scan (see lastScan); run that first for fresh data.',
  {
    query: z.string().min(1).describe('Words that must all appear (case and accent insensitive)'),
    course_id: z.number().int().optional(),
    kind: z.enum(['activity', 'file', 'link', 'discussion', 'post', 'page']).optional(),
    limit: z.number().int().min(1).max(200).optional(),
  },
  ({ query, course_id, kind, limit }) => api.searchContent(query, { courseId: course_id, kind, limit }));

tool('icorsi_download',
  'Download a file from iCorsi to the local disk and return its path. Accepts a file url (pluginfile.php), a File activity url, '
  + 'or https://www.icorsi.ch/mod/folder/download_folder.php?id=<folder activity id> to get a whole folder as zip.',
  {
    url: z.string().url(),
    dir: z.string().optional().describe('Destination directory (default: the server download directory)'),
  },
  ({ url, dir }) => api.download(url, dir ? { dir } : {}),
  { readOnlyHint: false });

tool('icorsi_login',
  'Force a new login. Normally not needed: every tool logs in by itself, opening a browser window for the Microsoft login only when required.',
  {},
  () => api.login(),
  { readOnlyHint: false });

await server.connect(new StdioServerTransport());
console.error('[icorsi] MCP server ready');
