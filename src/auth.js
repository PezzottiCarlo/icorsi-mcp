// Login via Microsoft (OIDC) through a real browser, then hand the Moodle cookies to the HTTP client.
//
// The browser profile (.profile/) is persistent: after the first manual login Microsoft SSO
// usually completes on its own, so we first try headless and only open a window if that fails.

import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = 'https://www.icorsi.ch';
const PROFILE_DIR = path.join(ROOT, '.profile');
const SESSION_FILE = path.join(ROOT, '.session.json');

export function loadSession() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return null; }
}

export function saveSession(session) {
  fs.writeFileSync(SESSION_FILE, JSON.stringify(session, null, 2));
}

async function tryLogin({ headless, timeoutMs }) {
  const browser = await puppeteer.launch({ headless, defaultViewport: null, userDataDir: PROFILE_DIR });
  try {
    const [page] = await browser.pages();
    // /auth/oidc/ starts the Microsoft flow directly and lands on /my/ when done
    await page.goto(`${BASE}/auth/oidc/`, { waitUntil: 'domcontentloaded' }).catch(() => {});

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!browser.connected) return null; // window closed by the user
      const userId = page.url().startsWith(BASE)
        ? await page.evaluate(() => window.M?.cfg?.userId ?? 0).catch(() => 0) // throws mid-navigation
        : 0;
      if (userId > 0) {
        const cdp = await page.createCDPSession();
        const { cookies } = await cdp.send('Network.getCookies', { urls: [BASE] });
        return {
          savedAt: Date.now(),
          userAgent: await browser.userAgent(),
          cookies: Object.fromEntries(cookies.map((c) => [c.name, c.value])),
        };
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  } finally {
    await browser.close().catch(() => {});
  }
}

export async function login({ interactive = true } = {}) {
  let session = await tryLogin({ headless: true, timeoutMs: 25_000 });
  if (!session && interactive) {
    console.error('[icorsi] login richiesto: completa l\'accesso Microsoft nella finestra del browser...');
    session = await tryLogin({ headless: false, timeoutMs: 5 * 60_000 });
  }
  if (!session) throw new Error('iCorsi login failed (timeout or browser closed)');
  saveSession(session);
  return session;
}
