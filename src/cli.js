// Tiny CLI to try the API: node src/cli.js <command> [args]

import { ICorsi } from './client.js';

const [cmd, ...args] = process.argv.slice(2);
const api = new ICorsi();

const commands = {
  login: () => api.login(),
  home: () => api.getHome(),
  courses: () => api.getCourses(),
  course: () => api.getCourseContents(args[0]),
  search: () => api.searchCourses(args.join(' ')),
  calendar: () => api.getCalendarMonth({ year: args[0], month: args[1] }),
  event: () => api.getCalendarEvent(args[0]),
  activity: () => api.getActivity(args[0]),
  new: () => api.findNewContent({ markSeen: !args.includes('--dry') }),
  find: () => api.searchContent(args.join(' ')),
  download: () => api.download(args[0], args[1] ? { dir: args[1] } : {}),
};

if (!commands[cmd]) {
  console.error(`Usage: node src/cli.js <command>

  login                    force a new login
  home                     user, courses and upcoming deadlines
  courses                  enrolled courses
  course <id>              sections and activities of a course
  search <query>           search the course catalogue
  calendar [year] [month]  calendar events of a month
  event <id>               a single calendar event
  activity <url>           everything inside an activity (files, posts, status...)
  new [--dry]              deep scan: new content across all courses since last scan
  find <query>             search activities / files / forum posts of all courses
  download <url> [dir]     download a file`);
  process.exit(1);
}

console.log(JSON.stringify(await commands[cmd](), null, 2));
