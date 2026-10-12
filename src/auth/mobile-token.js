// Mobile web service token, obtained like the official Moodle app does: launch.php with the
// cookie session answers with a redirect to moodlemobile://token=<base64(siteid:::token:::private)>.

import { randomBytes } from 'node:crypto';
import { TokenInvalid } from '../errors.js';

export function launchPath(passport = randomBytes(8).toString('hex')) {
  const qs = new URLSearchParams({ service: 'moodle_mobile_app', passport, urlscheme: 'moodlemobile' });
  return `/admin/tool/mobile/launch.php?${qs}`;
}

export function parseLaunchRedirect(location) {
  const b64 = location?.match(/^moodlemobile:\/\/token=([A-Za-z0-9+/=]+)/)?.[1];
  if (!b64) throw new TokenInvalid('iCorsi did not hand out a mobile app token');
  const token = Buffer.from(b64, 'base64').toString('utf8').split(':::')[1];
  if (!/^[0-9a-f]{32}$/.test(token ?? '')) throw new TokenInvalid('iCorsi returned a malformed mobile app token');
  return token;
}

/** `web.get` follows the cookie session (logging in when needed) and exposes app-scheme redirects as externalUrl */
export async function fetchMobileToken(web) {
  const res = await web.get(launchPath());
  if (res.externalUrl) return parseLaunchRedirect(res.externalUrl);
  // iOS-style answer: a page whose "launchapp" link opens the app
  return parseLaunchRedirect((await res.text()).match(/moodlemobile:\/\/token=[A-Za-z0-9+/=]+/)?.[0]);
}
