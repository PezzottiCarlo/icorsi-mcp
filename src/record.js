// Opens iCorsi in a visible Chromium and records EVERYTHING into captures/<timestamp>/
//
//   events.jsonl   every raw CDP Network/Page/Log/Runtime event (all headers, raw + extraInfo,
//                  cookies, post data, redirects, websockets, SSE...) with timestamp + target
//   bodies/        response body of every request (<requestId>.<ext>) + bodies/index.jsonl
//   pages/         HTML snapshot (rendered DOM + storage) at every navigation/load
//   cookies.json   full cookie jar, refreshed periodically and at exit
//   screenshots/   screenshot at every page load
//
// Browser profile is persistent (.profile/) so the login survives between runs.
// Ctrl+C (or closing the browser) to stop.

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START_URL = process.argv[2] || 'https://www.icorsi.ch';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.join(ROOT, 'captures', stamp);
for (const d of ['bodies', 'pages', 'screenshots']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

const eventsStream = fs.createWriteStream(path.join(OUT, 'events.jsonl'));
const bodiesIndex = fs.createWriteStream(path.join(OUT, 'bodies', 'index.jsonl'));
const log = (stream, obj) => stream.write(JSON.stringify(obj) + '\n');

const EXT = {
  'text/html': 'html', 'application/json': 'json', 'text/css': 'css', 'text/plain': 'txt',
  'application/javascript': 'js', 'text/javascript': 'js', 'application/xml': 'xml', 'text/xml': 'xml',
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp',
  'application/pdf': 'pdf', 'text/calendar': 'ics',
};
const extFor = (mime = '') => EXT[mime.split(';')[0].trim().toLowerCase()] || 'bin';

let pageCounter = 0;
const attached = new Set();
const pending = new Map(); // `${targetId}:${requestId}` -> { url, mimeType }

async function attachTarget(target, browser) {
  const type = target.type();
  if (type === 'browser') return;
  const id = target._targetId;
  if (attached.has(id)) return;
  attached.add(id);

  let cdp;
  try { cdp = await target.createCDPSession(); } catch { return; }
  const meta = () => ({ t: Date.now(), target: id, targetType: type });
  const emit = (method, params) => log(eventsStream, { ...meta(), method, params });

  // Record every event of these domains, raw.
  const domains = ['Network', 'Page', 'Log', 'Runtime', 'Security'];
  for (const domain of domains) {
    try {
      // Network: no size limits so bodies can always be fetched
      await cdp.send(`${domain}.enable`, domain === 'Network'
        ? { maxTotalBufferSize: 1 << 30, maxResourceBufferSize: 1 << 28 } : {});
    } catch { /* domain not available for this target type */ }
  }
  const origEmit = cdp.emit.bind(cdp);
  cdp.emit = (event, ...args) => {
    if (typeof event === 'string' && /^(Network|Page|Log|Runtime|Security)\./.test(event)) emit(event, args[0]);
    return origEmit(event, ...args);
  };

  cdp.on('Network.requestWillBeSent', (e) => {
    pending.set(`${id}:${e.requestId}`, { url: e.request.url });
  });
  cdp.on('Network.responseReceived', (e) => {
    const p = pending.get(`${id}:${e.requestId}`) || {};
    pending.set(`${id}:${e.requestId}`, { ...p, url: e.response.url, mimeType: e.response.mimeType, status: e.response.status });
  });
  cdp.on('Network.loadingFinished', async (e) => {
    const key = `${id}:${e.requestId}`;
    const info = pending.get(key) || {};
    pending.delete(key);
    try {
      const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: e.requestId });
      const file = `${e.requestId}.${extFor(info.mimeType)}`;
      fs.writeFileSync(path.join(OUT, 'bodies', file), base64Encoded ? Buffer.from(body, 'base64') : body);
      log(bodiesIndex, { ...meta(), requestId: e.requestId, file, url: info.url, status: info.status, mimeType: info.mimeType, size: e.encodedDataLength });
    } catch (err) {
      log(bodiesIndex, { ...meta(), requestId: e.requestId, url: info.url, status: info.status, error: String(err.message || err) });
    }
  });
  cdp.on('Network.loadingFailed', (e) => pending.delete(`${id}:${e.requestId}`));
}

async function snapshotPage(page, reason) {
  const n = String(++pageCounter).padStart(4, '0');
  try {
    const url = page.url();
    const html = await page.content();
    const storage = await page.evaluate(() => ({
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      title: document.title,
      referrer: document.referrer,
    })).catch(() => ({}));
    const slug = url.replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/gi, '_').slice(0, 80);
    fs.writeFileSync(path.join(OUT, 'pages', `${n}_${slug}.html`), html);
    fs.writeFileSync(path.join(OUT, 'pages', `${n}_${slug}.meta.json`),
      JSON.stringify({ t: Date.now(), reason, url, ...storage }, null, 2));
    await page.screenshot({ path: path.join(OUT, 'screenshots', `${n}_${slug}.png`), fullPage: true }).catch(() => {});
    console.log(`[page ${n}] ${reason} ${url}`);
  } catch (err) {
    console.log(`[page ${n}] snapshot failed: ${err.message}`);
  }
}

async function watchPage(page) {
  page.on('load', () => snapshotPage(page, 'load'));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) log(eventsStream, { t: Date.now(), method: 'puppeteer.framenavigated', params: { url: frame.url() } });
  });
  page.on('console', (m) => log(eventsStream, { t: Date.now(), method: 'puppeteer.console', params: { type: m.type(), text: m.text(), location: m.location() } }));
  page.on('pageerror', (e) => log(eventsStream, { t: Date.now(), method: 'puppeteer.pageerror', params: { message: String(e) } }));
}

const browser = await puppeteer.launch({
  headless: false,
  defaultViewport: null,
  userDataDir: path.join(ROOT, '.profile'),
  args: ['--start-maximized'],
});

browser.on('targetcreated', async (target) => {
  await attachTarget(target, browser);
  if (target.type() === 'page') {
    const page = await target.page().catch(() => null);
    if (page) watchPage(page);
  }
});
browser.on('targetchanged', (target) => log(eventsStream, { t: Date.now(), method: 'puppeteer.targetchanged', params: { url: target.url(), type: target.type() } }));

// Targets that already exist (the initial about:blank tab)
for (const target of browser.targets()) {
  await attachTarget(target, browser);
  if (target.type() === 'page') {
    const page = await target.page().catch(() => null);
    if (page) watchPage(page);
  }
}

async function dumpCookies() {
  try {
    const cdp = await browser.target().createCDPSession();
    const { cookies } = await cdp.send('Storage.getCookies');
    fs.writeFileSync(path.join(OUT, 'cookies.json'), JSON.stringify(cookies, null, 2));
    await cdp.detach();
  } catch { /* browser already closed */ }
}
const cookieTimer = setInterval(dumpCookies, 10_000);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(cookieTimer);
  await dumpCookies();
  await Promise.all([eventsStream, bodiesIndex].map((s) => new Promise((r) => s.end(r))));
  console.log(`\nCapture saved in ${OUT}`);
  await browser.close().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
browser.on('disconnected', shutdown);

const [page] = await browser.pages();
console.log(`Recording to ${OUT}\nNavigating to ${START_URL} ... browse freely, Ctrl+C to stop.`);
await page.goto(START_URL, { waitUntil: 'load' }).catch((e) => console.log('goto:', e.message));
