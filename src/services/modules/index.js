// Activity type -> handler(ctx, cm, mod) returning the type-specific part of icorsi_get_activity.

import * as content from './content.js';
import { forum } from './forum.js';
import { assign } from './assign.js';
import { quiz } from './quiz.js';

export const HANDLERS = {
  page: content.page,
  book: content.book,
  label: content.label,
  resource: content.resource,
  folder: content.folder,
  imscp: content.imscp,
  url: content.url,
  forum,
  assign,
  quiz,
};

/** Types whose content iCorsi does not expose to the web service (hvp, wooclap, ...) */
export async function generic(ctx, cm) {
  return { note: `iCorsi does not expose the content of ${cm.modname} activities: open the url in a browser` };
}
