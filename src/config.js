// Constants and file locations shared by every layer.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASE = 'https://www.icorsi.ch';
export const DEFAULT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export const PATHS = {
  profile: path.join(ROOT, '.profile'),
  session: path.join(ROOT, '.session.json'),
  index: path.join(ROOT, '.state', 'index.json'),
  downloads: process.env.ICORSI_DOWNLOAD_DIR || path.join(ROOT, 'downloads'),
};
