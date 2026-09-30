// HTML -> data for Moodle activity pages (folder, forum, discussion, assignment, page, url, book...)

import * as cheerio from 'cheerio';
import { BASE } from './auth.js';

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const MAX_TEXT = 15_000;

export const isFileUrl = (url) => /\/pluginfile\.php\//.test(url);

/** File name from a pluginfile URL (the Content-Disposition header has broken accents) */
export function fileNameFromUrl(url) {
  const last = new URL(url, BASE).pathname.split('/').pop();
  try { return decodeURIComponent(last); } catch { return last; }
}

// Same file is often linked with and without ?forcedownload=1
const fileKey = (url) => url.split('?')[0];

function collectFiles($, scope) {
  const files = new Map();
  scope.find('a[href*="/pluginfile.php/"]').each((_, a) => {
    const url = $(a).attr('href');
    if (!files.has(fileKey(url))) files.set(fileKey(url), { name: clean($(a).text()) || fileNameFromUrl(url), url });
  });
  // embedded documents / media (not images: those are decoration)
  scope.find('iframe[src*="/pluginfile.php/"], embed[src*="/pluginfile.php/"], source[src*="/pluginfile.php/"], video[src*="/pluginfile.php/"], audio[src*="/pluginfile.php/"], object[data*="/pluginfile.php/"]').each((_, el) => {
    const url = $(el).attr('src') ?? $(el).attr('data');
    if (!files.has(fileKey(url))) files.set(fileKey(url), { name: fileNameFromUrl(url), url });
  });
  return [...files.values()];
}

function collectLinks($, scope) {
  const links = new Map();
  scope.find('a[href^="http"]').each((_, a) => {
    const url = $(a).attr('href');
    if (!url.startsWith(BASE) && !links.has(url)) links.set(url, { name: clean($(a).text()) || url, url });
  });
  return [...links.values()];
}

/** Parses any activity page. Fields that do not apply are left out. */
export function parseActivityPage(html, url) {
  const $ = cheerio.load(html);
  const main = $('[role="main"]').first();
  main.find('script, style, template, #cmt-tmpl').remove();
  main.find('br').replaceWith(' ');

  const out = { url, title: clean($('h1').first().text()) || clean($('title').text()) };

  const dates = clean($('[data-region="activity-dates"]').text());
  if (dates) out.dates = dates;

  // Forum: list of discussions
  const discussions = main.find('tr.discussion[data-discussionid]').map((_, tr) => {
    const row = $(tr);
    const link = row.find('a[href*="discuss.php?d="]').first();
    return {
      id: Number(row.attr('data-discussionid')),
      title: clean(link.attr('title') || link.text()),
      url: link.attr('href'),
      author: clean(row.find('.author .author-info div').first().text()) || null,
    };
  }).get();
  if (discussions.length) out.discussions = discussions;

  // Forum discussion: posts (replies are nested inside the parent <article>, hence the "core" scope)
  const posts = main.find('article[data-post-id]').map((_, el) => {
    const core = $(el).find('[data-region-content="forum-post-core"]').first();
    return {
      id: Number($(el).attr('data-post-id')),
      subject: clean(core.find('[data-region-content="forum-post-core-subject"]').text()),
      author: clean(core.find('header a[href*="/user/view.php"]').first().text()) || null,
      date: core.find('header time').attr('datetime') ?? null,
      text: clean(core.find('.post-content-container').text()).slice(0, MAX_TEXT),
      files: collectFiles($, core),
    };
  }).get();
  if (posts.length) out.posts = posts;

  // Assignment: submission / grading status table
  const status = {};
  main.find('.submissionstatustable tr, .feedbacktable tr').each((_, tr) => {
    const key = clean($(tr).find('th').text());
    const cell = $(tr).find('td').clone();
    cell.find('.commentscontainer').remove();
    if (key && clean(cell.text())) status[key] = clean(cell.text());
  });
  if (Object.keys(status).length) out.status = status;

  // Book chapters, further pages of a forum
  const subpages = new Set();
  $('a[href*="/mod/book/view.php"][href*="chapterid="]').each((_, a) => subpages.add($(a).attr('href')));
  main.find('.pagination a[href*="page="]').each((_, a) => subpages.add($(a).attr('href')));
  subpages.delete(url);
  if (subpages.size) out.subpages = [...subpages];

  out.files = collectFiles($, main);
  out.links = collectLinks($, main);
  if (!posts.length) out.text = clean(main.text()).slice(0, MAX_TEXT);
  return out;
}

/** Files and external links placed directly on the course page (labels, section summaries) */
export function parseCoursePage(html) {
  const $ = cheerio.load(html);
  const found = [];
  const where = (el) => clean($(el).closest('li.activity').find('[data-activityname]').first().attr('data-activityname'))
    || clean($(el).closest('li.section').attr('data-sectionname') || $(el).closest('li.section').find('.sectionname').first().text())
    || null;
  const content = $('.course-content');
  content.find('a[href*="/pluginfile.php/"]').each((_, a) => {
    const url = $(a).attr('href');
    found.push({ kind: 'file', name: clean($(a).text()) || fileNameFromUrl(url), url, where: where(a) });
  });
  // links inside label / summary text only, not the activity links themselves
  content.find('.activity-altcontent a[href^="http"], .summarytext a[href^="http"], .description a[href^="http"]').each((_, a) => {
    const url = $(a).attr('href');
    if (!url.startsWith(BASE)) found.push({ kind: 'link', name: clean($(a).text()) || url, url, where: where(a) });
  });
  return found;
}

export { fileKey };
