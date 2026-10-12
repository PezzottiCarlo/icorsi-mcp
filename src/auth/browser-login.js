// Microsoft (OIDC) login through a real browser; returns the Moodle cookies for the HTTP client.
//
// The browser profile (.profile/) is persistent: after the first manual login Microsoft SSO
// usually completes on its own, so we first try headless and only open a window if that fails.

import puppeteer from 'puppeteer';
import { BASE, PATHS } from '../config.js';
import { IcorsiError } from '../errors.js';

async function tryLogin({ headless, timeoutMs }) {
  const browser = await puppeteer.launch({ headless, defaultViewport: null, userDataDir: PATHS.profile });
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

export async function browserLogin({ interactive = true } = {}) {
  let session = await tryLogin({ headless: true, timeoutMs: 25_000 });
  if (!session && interactive) {
    console.error('[icorsi] login richiesto: completa l\'accesso Microsoft nella finestra del browser...');
    session = await tryLogin({ headless: false, timeoutMs: 5 * 60_000 });
  }
  if (!session) throw new IcorsiError('iCorsi login failed (timeout or browser closed)');
  return session;
}
