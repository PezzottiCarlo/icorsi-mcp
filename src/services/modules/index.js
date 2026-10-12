// Activity type -> handler(ctx, cm, mod) returning the type-specific part of icorsi_get_activity.

import * as content from './content.js';
import * as others from './others.js';
import { forum } from './forum.js';
import { assign } from './assign.js';
import { quiz } from './quiz.js';
import { board } from './board.js';

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
  board,
  glossary: others.glossary,
  feedback: others.feedback,
  choicegroup: others.choicegroup,
  choice: others.choice,
  wiki: others.wiki,
  data: others.data,
  lesson: others.lesson,
  scorm: others.scorm,
  workshop: others.workshop,
  h5pactivity: others.h5pactivity,
  bigbluebuttonbn: others.bigbluebuttonbn,
  lti: others.lti,
};

/** Types whose content iCorsi does not expose to the web service (hvp, wooclap, ...) */
export async function generic(ctx, cm) {
  return { note: `iCorsi does not expose the content of ${cm.modname} activities: open the url in a browser` };
}
