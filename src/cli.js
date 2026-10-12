// Command-line interface to try the API: node src/cli.js <command> [args]

import { ICorsi } from './client.js';

const [cmd, ...args] = process.argv.slice(2);
const api = new ICorsi();
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const positional = args.filter((a) => !a.startsWith('--'));
const num = (i) => (positional[i] === undefined ? undefined : Number(positional[i]));

const commands = {
  login: () => api.login(),
  home: () => api.getHome(),
  courses: () => api.getCourses({ classification: positional[0] }),
  course: () => api.getCourse(positional[0]),
  activity: () => api.getActivity(positional[0]),
  'quiz-review': () => api.getQuizReview(num(0)),
  search: () => api.searchCourses(positional.join(' ')),
  calendar: () => api.getCalendarMonth({ year: num(0), month: num(1) }),
  day: () => api.getCalendarDay({ year: num(0), month: num(1), day: num(2) }),
  upcoming: () => api.getUpcoming(),
  event: () => api.getCalendarEvent(positional[0]),
  notifications: () => api.getNotifications({ unreadOnly: args.includes('--unread') }),
  messages: () => (positional[0] ? api.getConversation(num(0)) : api.getConversations()),
  grades: () => api.getGrades({ courseId: num(0) }),
  profile: () => api.getProfile(),
  participants: () => api.getParticipants(num(0), { role: positional[1] }),
  recent: () => api.getRecentItems(),
  new: () => api.findNewContent({ markSeen: !args.includes('--dry'), since: flag('since') }),
  find: () => api.searchContent(positional.join(' ')),
  download: () => api.download(positional[0], positional[1] ? { dir: positional[1] } : {}),
  api: () => api.call(positional[0], positional[1] ? JSON.parse(positional[1]) : {}, { transport: flag('transport') }),
};

if (!commands[cmd]) {
  console.error(`Usage: node src/cli.js <command>

  login                         force a new login
  home                          user, courses, deadlines, unread counters, recent activities
  courses [classification]      enrolled courses (all, inprogress, future, past, favourites, hidden)
  course <id>                   a course with its sections and activities
  activity <url|cmid>           everything inside an activity
  quiz-review <attemptId>       questions and answers of a quiz attempt
  search <query>                search the course catalogue
  calendar [year] [month]       calendar events of a month
  day [year] [month] [day]      calendar events of a day
  upcoming                      upcoming events
  event <id>                    a single calendar event
  notifications [--unread]      notifications
  messages [conversationId]     conversations, or the messages of one
  grades [courseId]             grades of every course, or the items of one
  profile                       my profile, private files, badges, forum posts
  participants <courseId> [role]  people enrolled in a course
  recent                        recently opened activities
  new [--dry] [--since=ISO]     new content since the last scan, or since a date
  find <query>                  search activities, files and forum posts of all courses
  download <url> [dir]          download a file, a File activity or a folder (zip)
  api <function> [jsonArgs] [--transport=ajax]  any read-only web service function`);
  process.exit(1);
}

console.log(JSON.stringify(await commands[cmd](), null, 2));
