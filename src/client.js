// Unofficial iCorsi (Moodle) client. Talks plain HTTP using the session cookies obtained by auth.js.

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as cheerio from 'cheerio';
import { parseActivityPage, parseCoursePage, fileNameFromUrl, fileKey, isFileUrl } from './parse.js';
import { BASE, ROOT, loadSession, saveSession, login } from './auth.js';

const INDEX_FILE = path.join(ROOT, '.state', 'index.json');
const DOWNLOAD_DIR = process.env.ICORSI_DOWNLOAD_DIR || path.join(ROOT, 'downloads');
const MAX_SUBPAGES = 60; // per activity: forum pages, book chapters

class SessionExpired extends Error {}

// Moodle web services return names with HTML entities (dell&#39;educazione)
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const text = (s) => s?.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e.toLowerCase()] ?? m;
  return String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
});

const slimCourse = (c) => c && ({
  id: c.id,
  fullname: text(c.fullname),
  shortname: c.shortname,
  category: text(c.coursecategory),
  url: c.viewurl,
  startdate: c.startdate,
  enddate: c.enddate,
  progress: c.progress,
  isfavourite: c.isfavourite,
  hidden: c.hidden,
});

const slimEvent = (e) => ({
  id: e.id,
  name: text(e.name),
  description: e.description,
  location: e.location,
  eventtype: e.eventtype,
  module: e.modulename,
  activityname: text(e.activityname),
  timestart: e.timestart,
  timeduration: e.timeduration,
  date: new Date(e.timestart * 1000).toISOString(),
  overdue: e.overdue,
  url: e.url,
  course: e.course && { id: e.course.id, fullname: text(e.course.fullname) },
});

export class ICorsi {
  #session = null;
  #sesskey = null;
  #user = null;
  #interactive;
  #inflight = {};

  constructor({ interactive = true } = {}) {
    this.#interactive = interactive; // false: never open a visible browser window
  }

  // ---- session -------------------------------------------------------------------------------

  // Concurrent callers share one login / one session check (the browser profile can't be opened twice)
  #once(key, fn) {
    return this.#inflight[key] ??= fn().finally(() => { this.#inflight[key] = null; });
  }

  login() {
    return this.#once('login', async () => {
      this.#sesskey = null;
      this.#session = await login({ interactive: this.#interactive });
      await this.#bootstrap();
      return this.#user;
    });
  }

  async #ensureSession() {
    if (this.#sesskey) return;
    await this.#once('ensure', async () => {
      this.#session ??= loadSession();
      if (this.#session) {
        try { return await this.#bootstrap(); } catch (e) { if (!(e instanceof SessionExpired)) throw e; }
      }
      await this.login();
    });
  }

  // Loads the dashboard to check the session is alive and to read sesskey + user info from M.cfg
  async #bootstrap() {
    const html = await this.#fetch('/my/').then((r) => r.text());
    const cfg = JSON.parse(html.match(/M\.cfg = (\{.*?\});/s)?.[1] ?? '{}');
    if (!cfg.sesskey || !cfg.userId) throw new SessionExpired();
    const $ = cheerio.load(html);
    this.#sesskey = cfg.sesskey;
    this.#user = {
      id: cfg.userId,
      // initials avatar has the name in title, a profile picture has it in alt
      fullname: $('.usermenu .avatar.current [title]').attr('title') || $('.usermenu .avatar.current img').attr('alt') || null,
      language: cfg.language,
      timezone: cfg.usertimezone,
    };
  }

  // Same-site redirects are followed (e.g. a File activity redirecting to the actual file).
  // A redirect leaving iCorsi is not followed: the response is returned with res.externalUrl set.
  async #fetch(target, init = {}, hops = 0) {
    const url = new URL(target, BASE);
    if (url.origin !== BASE) throw new Error(`Not an iCorsi URL: ${url}`);
    const pathname = url.pathname + url.search;
    const res = await fetch(url, {
      ...init,
      redirect: 'manual',
      headers: {
        'user-agent': this.#session.userAgent,
        'accept-language': 'it-IT,it;q=0.9',
        cookie: Object.entries(this.#session.cookies).map(([k, v]) => `${k}=${v}`).join('; '),
        ...init.headers,
      },
    });
    const setCookies = res.headers.getSetCookie();
    if (setCookies.length) {
      for (const sc of setCookies) {
        const [, name, value] = sc.match(/^([^=]+)=([^;]*)/) ?? [];
        if (name) this.#session.cookies[name] = value;
      }
      saveSession(this.#session);
    }
    if (res.status >= 300 && res.status < 400) {
      await res.body?.cancel();
      const next = new URL(res.headers.get('location'), url);
      // Moodle redirects to the login page when the session is gone
      if (/^\/(login|auth)\//.test(next.pathname) || /microsoftonline/.test(next.host)) throw new SessionExpired();
      if (next.origin !== BASE) { res.externalUrl = next.href; return res; }
      if (init.method === 'POST' || hops >= 5) throw new Error(`iCorsi unexpected redirect on ${pathname} -> ${next}`);
      return this.#fetch(next, init, hops + 1);
    }
    if (!res.ok) throw new Error(`iCorsi HTTP ${res.status} on ${pathname}`);
    return res;
  }

  // Retries once after a fresh login if the session expired mid-way
  async #withSession(fn) {
    await this.#ensureSession();
    try {
      return await fn();
    } catch (e) {
      if (!(e instanceof SessionExpired)) throw e;
      await this.login();
      return fn();
    }
  }

  // ---- low level -----------------------------------------------------------------------------

  /** Calls several Moodle AJAX web service functions in one request: [{ methodname, args }] */
  async ajaxBatch(calls) {
    return this.#withSession(async () => {
      const info = calls.length === 1 ? calls[0].methodname : `${calls.length}-method-calls`;
      const res = await this.#fetch(`/lib/ajax/service.php?sesskey=${this.#sesskey}&info=${info}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/javascript, */*; q=0.01',
          'x-requested-with': 'XMLHttpRequest',
          origin: BASE,
          referer: `${BASE}/my/`,
        },
        body: JSON.stringify(calls.map((c, index) => ({ index, methodname: c.methodname, args: c.args ?? {} }))),
      });
      const out = await res.json();
      if (!Array.isArray(out)) {
        if (['servicerequireslogin', 'invalidsesskey'].includes(out.errorcode)) { this.#sesskey = null; throw new SessionExpired(); }
        throw new Error(`iCorsi ajax error: ${out.error ?? JSON.stringify(out)}`);
      }
      return out.map((r, i) => {
        if (r.error) {
          const ex = r.exception ?? {};
          if (['servicerequireslogin', 'invalidsesskey', 'requireloginerror'].includes(ex.errorcode)) { this.#sesskey = null; throw new SessionExpired(); }
          throw new Error(`iCorsi ${calls[i].methodname}: ${ex.message ?? ex.errorcode ?? 'unknown error'}`);
        }
        return r.data;
      });
    });
  }

  async ajax(methodname, args = {}) {
    return (await this.ajaxBatch([{ methodname, args }]))[0];
  }

  /** GET an authenticated page and return its HTML */
  async getHtml(pathname) {
    return this.#withSession(() => this.#fetch(pathname).then((r) => r.text()));
  }

  // ---- high level ----------------------------------------------------------------------------

  async getUser() {
    await this.#ensureSession();
    return this.#user;
  }

  /** Enrolled courses. classification: all | inprogress | future | past | favourites | hidden */
  async getCourses({ classification = 'all' } = {}) {
    const data = await this.ajax('core_course_get_enrolled_courses_by_timeline_classification', {
      offset: 0, limit: 0, classification, sort: 'fullname', customfieldname: '', customfieldvalue: '',
    });
    return data.courses.map(slimCourse);
  }

  /** Upcoming deadlines (the dashboard "Timeline" block). Defaults to the next 7 days. */
  async getTimeline({ days = 7, limit = 50 } = {}) {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const timesortfrom = Math.floor(from / 1000);
    const data = await this.ajax('core_calendar_get_action_events_by_timesort', {
      limitnum: limit, timesortfrom, timesortto: timesortfrom + days * 86400, limittononsuspendedevents: true,
    });
    return data.events.map(slimEvent);
  }

  /** Everything shown on the home screen: user, courses and upcoming deadlines */
  async getHome({ days = 7 } = {}) {
    const [user, courses, timeline] = await Promise.all([this.getUser(), this.getCourses(), this.getTimeline({ days })]);
    return { user, courses, timeline };
  }

  /** Sections and activities of a course */
  async getCourseContents(courseId) {
    const state = JSON.parse(await this.ajax('core_courseformat_get_state', { courseid: Number(courseId) }));
    return stateToContents(state);
  }

  /** Search the whole iCorsi course catalogue */
  async searchCourses(query, { page = 0, perPage = 50 } = {}) {
    const qs = new URLSearchParams({ areaids: 'core_course-course', q: query, page, perpage: perPage });
    const $ = cheerio.load(await this.getHtml(`/course/search.php?${qs}`));
    const total = Number($('[role="main"] h2').first().text().match(/\d+/)?.[0] ?? 0);
    $('.summary br').replaceWith(' ');
    const courses = $('.course-search-result .coursebox').map((_, el) => {
      const box = $(el);
      const link = box.find('.coursename a').first();
      return {
        id: Number(box.attr('data-courseid')),
        fullname: link.text().trim().replace(/\s+/g, ' '),
        url: link.attr('href'),
        summary: box.find('.summary').text().trim().replace(/\s+/g, ' ') || null,
        teachers: box.find('.teachers a').map((_, a) => $(a).text().trim()).get(),
        category: box.find('.coursecat a').text().trim() || null,
        enrolment: box.find('.enrolmenticons [title]').map((_, i) => $(i).attr('title')).get(),
      };
    }).get();
    return { total, courses };
  }

  /** Calendar events of a month (defaults to the current one). courseId 1 = all courses */
  async getCalendarMonth({ year, month, courseId = 1 } = {}) {
    const now = new Date();
    year ??= now.getFullYear();
    month ??= now.getMonth() + 1;
    const data = await this.ajax('core_calendar_get_calendar_monthly_view', {
      year: String(year), month: String(month), courseid: Number(courseId), day: 1, view: 'month',
    });
    const seen = new Set();
    const events = data.weeks.flatMap((w) => w.days).flatMap((d) => d.events)
      .filter((e) => !seen.has(e.id) && seen.add(e.id)) // multi-day events appear on each day
      .map(slimEvent);
    return { year: Number(year), month: Number(month), period: data.periodname, events };
  }

  async getCalendarEvent(eventId) {
    const data = await this.ajax('core_calendar_get_calendar_event_by_id', { eventid: Number(eventId) });
    return slimEvent(data.event);
  }

  // ---- deep content --------------------------------------------------------------------------

  // Fetches an iCorsi URL and tells what is behind it: a file, an external link or an HTML page
  async #open(url) {
    return this.#withSession(async () => {
      const res = await this.#fetch(url);
      if (res.externalUrl) return { kind: 'external', url: res.externalUrl };
      if (!/text\/html/.test(res.headers.get('content-type') ?? '')) {
        await res.body?.cancel();
        return {
          kind: 'file',
          url: res.url,
          name: fileNameFromUrl(res.url),
          mimeType: res.headers.get('content-type'),
          size: Number(res.headers.get('content-length')) || null,
        };
      }
      return { kind: 'html', url: res.url, html: await res.text() };
    });
  }

  /**
   * Everything inside an activity: text, files, external links, assignment status,
   * forum discussions with all their posts, book chapters. `url` is the activity url from getCourseContents.
   * NOTE: this opens the activity like a browser would, so Moodle may mark it as "viewed".
   */
  async getActivity(url) {
    const page = await this.#open(url);
    if (page.kind === 'file') {
      return { url, title: page.name, files: [{ name: page.name, url: page.url, mimeType: page.mimeType, size: page.size }], links: [] };
    }
    if (page.kind === 'external') return { url, title: null, files: [], links: [{ name: page.url, url: page.url }] };

    const act = parseActivityPage(page.html, page.url);
    const merge = (list, extra, key) => {
      const seen = new Set(list.map(key));
      for (const x of extra ?? []) if (!seen.has(key(x))) { seen.add(key(x)); list.push(x); }
    };

    // further pages of the same activity: forum pagination, book chapters
    const visited = new Set([url, page.url]);
    const queue = [...(act.subpages ?? [])];
    delete act.subpages;
    while (queue.length && visited.size < MAX_SUBPAGES) {
      const next = queue.shift();
      if (visited.has(next)) continue;
      visited.add(next);
      const sub = await this.#open(next);
      if (sub.kind !== 'html') continue;
      const p = parseActivityPage(sub.html, next);
      merge(act.files, p.files, (f) => fileKey(f.url));
      merge(act.links, p.links, (l) => l.url);
      if (p.discussions) merge(act.discussions ??= [], p.discussions, (d) => d.id);
      else (act.pages ??= []).push({ title: p.title, url: next, text: p.text });
      queue.push(...(p.subpages ?? []));
    }

    await pool(act.discussions ?? [], 4, async (d) => {
      const sub = await this.#open(d.url);
      d.posts = sub.kind === 'html' ? parseActivityPage(sub.html, d.url).posts ?? [] : [];
    });
    return act;
  }

  // Every item reachable from a course: activities, files, links, forum discussions and posts, book pages
  async #scanCourse(course) {
    const items = {};
    const errors = [];
    const add = (key, item) => { items[key] ??= item; };

    const [contents, coursePage] = await Promise.all([
      this.getCourseContents(course.id),
      this.#open(`/course/view.php?id=${course.id}`),
    ]);
    if (coursePage.kind === 'html') {
      for (const f of parseCoursePage(coursePage.html)) {
        add(`${f.kind}:${f.kind === 'file' ? fileKey(f.url) : f.url}`, { kind: f.kind, name: f.name, url: f.url, path: f.where ?? 'Course page' });
      }
    }

    const activities = contents.sections.flatMap((s) => s.activities.map((a) => ({ ...a, section: s.title })));
    await pool(activities, 5, async (a) => {
      add(`activity:${a.id}`, { kind: 'activity', type: a.type, name: a.name, url: a.url, path: a.section });
      if (!a.url || !a.visible) return;
      const where = `${a.section} > ${a.name}`;
      try {
        const d = await this.getActivity(a.url);
        for (const f of d.files) add(`file:${fileKey(f.url)}`, { kind: 'file', name: f.name, url: f.url, path: where });
        for (const l of d.links) add(`link:${a.id}:${l.url}`, { kind: 'link', name: l.name, url: l.url, path: where });
        for (const p of d.pages ?? []) add(`page:${p.url}`, { kind: 'page', name: p.title, url: p.url, path: where });
        for (const disc of d.discussions ?? []) {
          add(`discussion:${disc.id}`, { kind: 'discussion', name: disc.title, author: disc.author, url: disc.url, path: where });
          for (const p of disc.posts) {
            const inDisc = `${where} > ${disc.title}`;
            add(`post:${p.id}`, { kind: 'post', name: p.subject, author: p.author, date: p.date, url: `${disc.url}#p${p.id}`, path: inDisc, text: p.text.slice(0, 300) });
            for (const f of p.files) add(`file:${fileKey(f.url)}`, { kind: 'file', name: f.name, url: f.url, path: inDisc });
          }
        }
      } catch (e) {
        errors.push({ activity: a.name, url: a.url, error: e.message });
      }
    });
    return { items, errors };
  }

  /**
   * Deep scan of the enrolled courses (or just one): goes inside every activity, folder, forum
   * discussion and book, and returns whatever was not there at the previous scan.
   * The first scan of a course only records a baseline.
   * markSeen=false leaves the stored index untouched (the same items are reported again next time).
   */
  async findNewContent({ courseId, markSeen = true } = {}) {
    let courses = await this.getCourses();
    if (courseId) courses = courses.filter((c) => c.id === Number(courseId));
    if (!courses.length) throw new Error(`Not enrolled in course ${courseId}`);

    const index = loadIndex();
    const now = Date.now();
    const result = [];
    await pool(courses, 2, async (course) => {
      const { items, errors } = await this.#scanCourse(course);
      const known = index.courses[course.id];
      const stored = (index.courses[course.id] ??= { items: {} });
      const fresh = [];
      for (const [key, item] of Object.entries(items)) {
        if (stored.items[key]) continue;
        stored.items[key] = { ...item, firstSeen: now };
        if (known) fresh.push(item);
      }
      Object.assign(stored, { name: course.fullname, url: course.url, scannedAt: now });
      result.push({
        course: { id: course.id, fullname: course.fullname, url: course.url },
        baseline: !known,
        totalItems: Object.keys(items).length,
        newItems: fresh,
        ...(errors.length && { errors }),
      });
    });

    if (markSeen) saveIndex(index);
    return result;
  }

  /**
   * Searches names / paths / forum text of everything found by the last deep scan, across all courses.
   * kind: activity | file | link | discussion | post | page
   */
  async searchContent(query, { courseId, kind, limit = 50 } = {}) {
    let index = loadIndex();
    if (!Object.keys(index.courses).length) {
      await this.findNewContent();
      index = loadIndex();
    }
    const norm = (s) => (s ?? '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const tokens = norm(query).split(/\s+/).filter(Boolean);
    const matches = [];
    for (const [id, course] of Object.entries(index.courses)) {
      if (courseId && Number(id) !== Number(courseId)) continue;
      for (const item of Object.values(course.items)) {
        if (kind && item.kind !== kind) continue;
        const hay = norm(`${item.name} ${item.path} ${item.author ?? ''} ${item.text ?? ''}`);
        if (tokens.every((t) => hay.includes(t))) matches.push({ course: { id: Number(id), fullname: course.name }, ...item });
      }
    }
    const lastScan = Math.min(...Object.values(index.courses).map((c) => c.scannedAt));
    return { total: matches.length, lastScan: new Date(lastScan).toISOString(), matches: matches.slice(0, limit) };
  }

  /**
   * Downloads a file (pluginfile url, a File activity url, or a folder's download_folder.php url).
   * Saved in `dir` (default: ICORSI_DOWNLOAD_DIR or ./downloads). Returns the local path.
   */
  async download(url, { dir = DOWNLOAD_DIR } = {}) {
    return this.#withSession(async () => {
      const isHtml = (r) => /text\/html/.test(r.headers.get('content-type') ?? '');
      let res = await this.#fetch(url);
      if (res.externalUrl) throw new Error(`Not a file: it redirects to ${res.externalUrl}`);
      if (isHtml(res)) {
        // a File activity shown embedded in a page: take the file out of it
        const { files } = parseActivityPage(await res.text(), res.url);
        if (files.length !== 1) throw new Error(`Not a file: that page contains ${files.length} files, list them with getActivity`);
        res = await this.#fetch(files[0].url);
        if (res.externalUrl || isHtml(res)) throw new Error(`Could not download ${files[0].url}`);
      }

      let name = fileNameFromUrl(res.url);
      if (!isFileUrl(res.url)) {
        // generated downloads (folder zip): the name is only in the header
        const cd = res.headers.get('content-disposition') ?? '';
        const star = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        const plain = cd.match(/filename="?([^";]+)"?/)?.[1]; // utf8 bytes read as latin1
        if (star) name = decodeURIComponent(star);
        else if (plain) name = Buffer.from(plain, 'latin1').toString('utf8');
      }
      name = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');

      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file));
      return { path: file, name, mimeType: res.headers.get('content-type'), size: fs.statSync(file).size };
    });
  }
}

function loadIndex() {
  try { return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch { return { courses: {} }; }
}

function saveIndex(index) {
  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// Runs fn over items with at most `size` in flight
async function pool(items, size, fn) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}

function stateToContents(state) {
  const cms = new Map(state.cm.map((cm) => [cm.id, cm]));
  return {
    id: Number(state.course.id),
    url: state.course.baseurl,
    sections: state.section.map((s) => ({
      id: Number(s.id),
      number: s.number,
      title: text(s.title),
      url: s.sectionurl,
      visible: s.visible,
      activities: (s.cmlist ?? []).map((id) => cms.get(id)).filter(Boolean).map((cm) => ({
        id: Number(cm.id),
        name: text(cm.name),
        type: cm.module,
        typeName: cm.modname,
        url: cm.url ?? null,
        visible: cm.uservisible,
        completed: cm.completionstate === undefined ? null : cm.completionstate > 0,
      })),
    })),
  };
}
