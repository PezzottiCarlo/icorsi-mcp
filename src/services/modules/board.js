// Boards (mod_board, a third-party plugin): only the website AJAX service exposes them.
// Note authors are user ids; they are not resolved to names, so anonymous boards stay anonymous.

import { compact, decode, toIso } from '../../util/text.js';
import { htmlToText } from '../../util/html.js';

const mapNote = (n) => compact({
  id: n.id,
  heading: decode(n.heading) || undefined,
  text: htmlToText(n.content),
  url: n.url || undefined,
  date: toIso(n.timecreated),
});

export async function board(ctx, cm) {
  const args = { id: cm.instance, ownerid: 0, groupid: 0 };
  const [config, content] = await ctx.web.batch([
    { fn: 'mod_board_get_configuration', args },
    { fn: 'mod_board_get_board', args },
  ]);
  if (content.error) throw content.error;
  const settings = config.data?.settings ? JSON.parse(config.data.settings) : {};
  const withComments = [];
  const columns = content.data.map((c) => compact({
    id: c.id,
    name: decode(c.name),
    locked: c.locked || undefined,
    notes: (c.notes ?? []).map((n) => {
      const note = mapNote(n);
      if (n.commentcount > 0) withComments.push(note);
      return note;
    }),
  }));
  // comments only for the notes that have some, all in one AJAX request
  const comments = await ctx.web.batch(withComments.map((n) => ({ fn: 'mod_board_get_comments', args: { noteid: n.id } })));
  withComments.forEach((note, i) => {
    const list = (comments[i].data?.comments ?? []).map((x) => compact({ text: htmlToText(x.content), date: toIso(x.timecreated) }));
    if (list.length) note.comments = list;
  });
  return compact({ intro: htmlToText(settings.board?.intro), columns });
}
