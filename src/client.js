// The ICorsi client: every read-only feature in one object. Used by the MCP server, the CLI and as a library.

import { SessionStore } from './auth/session-store.js';
import { createContext } from './context.js';
import { loadIndex } from './store/index-store.js';
import { getHome } from './services/home.js';
import { getCourses, getCourse, searchCourses, getRecentItems } from './services/courses.js';
import { getActivity } from './services/activities.js';
import { quizReview } from './services/modules/quiz.js';
import { getTimeline, getCalendarMonth, getCalendarDay, getUpcoming, getCalendarEvent } from './services/calendar.js';
import { getNotifications } from './services/notifications.js';
import { getConversations, getConversation } from './services/messages.js';
import { getGradesOverview, getCourseGrades } from './services/grades.js';
import { getProfile } from './services/profile.js';
import { getParticipants } from './services/participants.js';
import { findNewContent } from './services/updates.js';
import { searchIndex } from './services/search.js';
import { download } from './services/files.js';

// Fields that work as credentials (site info carries userprivateaccesskey, for instance)
const SECRETS = new Set(['userprivateaccesskey', 'token', 'privatetoken', 'wstoken', 'sesskey']);

function withoutSecrets(value) {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !SECRETS.has(k)).map(([k, v]) => [k, withoutSecrets(v)]));
  }
  return value;
}

export class ICorsi {
  #ctx;

  /** interactive: false never opens a visible browser window; store and fetchImpl are for tests */
  constructor({ interactive = true, store, fetchImpl } = {}) {
    this.#ctx = createContext({ store: store ?? new SessionStore({ interactive }), fetchImpl });
  }

  /** Forces a new browser login and a new web service token */
  async login() {
    await this.#ctx.store.login();
    this.#ctx.store.setToken(null);
    this.#ctx.web.reset();
    this.#ctx.cache.clear();
    return this.getUser();
  }

  async getUser() {
    const s = await this.#ctx.siteInfo();
    return { id: s.userid, fullname: s.fullname, username: s.username, lang: s.lang };
  }

  getHome(opts) { return getHome(this.#ctx, opts); }
  getCourses(opts) { return getCourses(this.#ctx, opts); }
  getCourse(courseId) { return getCourse(this.#ctx, courseId); }
  /** v1 name of getCourse */
  getCourseContents(courseId) { return getCourse(this.#ctx, courseId); }
  searchCourses(query, opts) { return searchCourses(this.#ctx, query, opts); }
  getRecentItems(opts) { return getRecentItems(this.#ctx, opts); }

  /** ref: activity url, cmid, { url } or { cmid } */
  getActivity(ref) { return getActivity(this.#ctx, ref); }
  getQuizReview(attemptId) { return quizReview(this.#ctx, attemptId); }

  getTimeline(opts) { return getTimeline(this.#ctx, opts); }
  getCalendarMonth(opts) { return getCalendarMonth(this.#ctx, opts); }
  getCalendarDay(opts) { return getCalendarDay(this.#ctx, opts); }
  getUpcoming(opts) { return getUpcoming(this.#ctx, opts); }
  getCalendarEvent(eventId) { return getCalendarEvent(this.#ctx, eventId); }

  getNotifications(opts) { return getNotifications(this.#ctx, opts); }
  getConversations() { return getConversations(this.#ctx); }
  getConversation(conversationId, opts) { return getConversation(this.#ctx, conversationId, opts); }

  getGrades({ courseId } = {}) { return courseId ? getCourseGrades(this.#ctx, courseId) : getGradesOverview(this.#ctx); }
  getProfile() { return getProfile(this.#ctx); }
  getParticipants(courseId, opts) { return getParticipants(this.#ctx, courseId, opts); }

  findNewContent(opts) { return findNewContent(this.#ctx, opts); }

  /** Searches the index of the last scan; the first call runs a scan to build it */
  async searchContent(query, opts) {
    let index = loadIndex();
    if (!Object.keys(index.courses).length) {
      await this.findNewContent();
      index = loadIndex();
    }
    return searchIndex(index, query, opts);
  }

  download(url, opts) { return download(this.#ctx, url, opts); }

  /** Any read-only function: transport 'ws' (mobile web service, default) or 'ajax' (website). Credentials are stripped. */
  async call(fn, args = {}, { transport = 'ws' } = {}) {
    return withoutSecrets(await (transport === 'ajax' ? this.#ctx.web.call(fn, args) : this.#ctx.ws.call(fn, args)));
  }

  /** v1: a website AJAX function */
  ajax(fn, args = {}) { return this.#ctx.web.call(fn, args); }
}
