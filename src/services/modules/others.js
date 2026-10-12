// Every other activity type: what the mobile web service lets a student read about it.

import { compact, decode, toIso } from '../../util/text.js';
import { htmlToText, htmlLinks } from '../../util/html.js';
import { instanceOf, introOf, mapFiles } from '../common.js';

const MAX_WIKI_PAGES = 50;
const OPTION_TYPES = new Set(['multichoice', 'multichoicerated']);
const isDone = (v) => v === true || v === 1 || v === '1' || v === 'true';

export async function glossary(ctx, cm) {
  const g = await instanceOf(ctx, 'mod_glossary_get_glossaries_by_courses', 'glossaries', cm);
  const r = await ctx.ws.call('mod_glossary_get_entries_by_letter', { id: cm.instance, letter: 'ALL', from: 0, limit: 500 });
  return compact({
    ...introOf(g),
    count: r.count,
    entries: r.entries.map((e) => compact({
      concept: decode(e.concept),
      author: e.userfullname,
      date: toIso(e.timecreated),
      text: htmlToText(e.definition, { max: 3000 }),
      files: mapFiles(e.attachments),
    })),
  });
}

/** Questions of a feedback (survey) activity; answers of other people are never read */
export async function feedback(ctx, cm) {
  const f = await instanceOf(ctx, 'mod_feedback_get_feedbacks_by_courses', 'feedbacks', cm);
  const [access, items] = await ctx.ws.batch([
    { fn: 'mod_feedback_get_feedback_access_information', args: { feedbackid: cm.instance } },
    { fn: 'mod_feedback_get_items', args: { feedbackid: cm.instance } },
  ]);
  return compact({
    ...introOf(f),
    anonymous: f?.anonymous === 1 || undefined,
    open: access.data?.isopen,
    submitted: access.data?.isalreadysubmitted,
    opens: toIso(f?.timeopen),
    closes: toIso(f?.timeclose),
    questions: (items.data?.items ?? []).filter((i) => i.typ !== 'pagebreak').map((i) => compact({
      number: i.itemnumber ?? undefined,
      type: i.typ,
      question: htmlToText(i.name) || (i.typ === 'label' ? htmlToText(i.presentation) : ''),
      required: i.required || undefined,
      options: OPTION_TYPES.has(i.typ)
        ? i.presentation.replace(/^[a-z]>>>>>/, '').split(/\r?\|/).map((o) => o.replace(/^\d+####/, '').trim())
        : undefined,
    })),
  });
}

export async function choicegroup(ctx, cm) {
  const r = await ctx.ws.call('mod_choicegroup_get_choicegroup_options', { choicegroupid: cm.instance, userid: await ctx.userId() });
  return {
    options: r.options.map((o) => compact({
      name: decode(o.name),
      members: o.countanswers,
      max: o.maxanswers || undefined,
      chosen: o.checked || undefined,
      disabled: o.disabled || undefined,
    })),
  };
}

export async function choice(ctx, cm) {
  const c = await instanceOf(ctx, 'mod_choice_get_choices_by_courses', 'choices', cm);
  const [options, results] = await ctx.ws.batch([
    { fn: 'mod_choice_get_choice_options', args: { choiceid: cm.instance } },
    { fn: 'mod_choice_get_choice_results', args: { choiceid: cm.instance } },
  ]);
  const votes = new Map((results.data?.options ?? []).map((o) => [o.id, o.numberofuser]));
  return compact({
    ...introOf(c),
    opens: toIso(c?.timeopen),
    closes: toIso(c?.timeclose),
    options: (options.data?.options ?? []).map((o) => compact({ text: decode(o.text), chosen: o.checked || undefined, votes: votes.get(o.id), max: o.maxanswers || undefined })),
  });
}

export async function wiki(ctx, cm) {
  const w = await instanceOf(ctx, 'mod_wiki_get_wikis_by_courses', 'wikis', cm);
  const { subwikis } = await ctx.ws.call('mod_wiki_get_subwikis', { wikiid: cm.instance });
  const lists = await ctx.ws.batch(subwikis.map((s) => ({ fn: 'mod_wiki_get_subwiki_pages', args: { wikiid: cm.instance, groupid: s.groupid, userid: s.userid } })));
  const pages = lists.flatMap((l) => l.data?.pages ?? []).slice(0, MAX_WIKI_PAGES);
  const contents = await ctx.ws.batch(pages.map((p) => ({ fn: 'mod_wiki_get_page_contents', args: { pageid: p.id } })));
  return compact({
    ...introOf(w),
    pages: pages.map((p, i) => compact({ title: decode(p.title), modified: toIso(p.timemodified), text: htmlToText(contents[i].data?.page?.cachedcontent, { max: 5000 }) })),
  });
}

export async function data(ctx, cm) {
  const d = await instanceOf(ctx, 'mod_data_get_databases_by_courses', 'databases', cm);
  const [fields, entries] = await ctx.ws.batch([
    { fn: 'mod_data_get_fields', args: { databaseid: cm.instance } },
    { fn: 'mod_data_get_entries', args: { databaseid: cm.instance, returncontents: true, page: 0, perpage: 100 } },
  ]);
  const names = new Map((fields.data?.fields ?? []).map((f) => [f.id, decode(f.name)]));
  return compact({
    ...introOf(d),
    total: entries.data?.totalcount,
    entries: (entries.data?.entries ?? []).map((e) => compact({
      author: e.fullname,
      date: toIso(e.timecreated),
      fields: Object.fromEntries((e.contents ?? []).map((c) => [names.get(c.fieldid) ?? String(c.fieldid), htmlToText(c.content, { max: 2000 })])),
    })),
  });
}

export async function lesson(ctx, cm) {
  const l = await instanceOf(ctx, 'mod_lesson_get_lessons_by_courses', 'lessons', cm);
  const [access, grade] = await ctx.ws.batch([
    { fn: 'mod_lesson_get_lesson_access_information', args: { lessonid: cm.instance } },
    { fn: 'mod_lesson_get_user_grade', args: { lessonid: cm.instance } },
  ]);
  return compact({
    ...introOf(l),
    opens: toIso(l?.available),
    closes: toIso(l?.deadline),
    timeLimit: l?.timelimit || undefined,
    attempts: access.data?.attemptscount,
    blocked: (access.data?.preventaccessreasons ?? []).map((r) => r.message),
    grade: grade.data?.formattedgrade ?? undefined,
  });
}

export async function scorm(ctx, cm) {
  const s = await instanceOf(ctx, 'mod_scorm_get_scorms_by_courses', 'scorms', cm);
  const [count, scoes] = await ctx.ws.batch([
    { fn: 'mod_scorm_get_scorm_attempt_count', args: { scormid: cm.instance, userid: await ctx.userId() } },
    { fn: 'mod_scorm_get_scorm_scoes', args: { scormid: cm.instance } },
  ]);
  return compact({
    ...introOf(s),
    opens: toIso(s?.timeopen),
    closes: toIso(s?.timeclose),
    maxAttempts: s?.maxattempt || undefined,
    attempts: count.data?.attemptscount,
    items: (scoes.data?.scoes ?? []).filter((x) => x.launch).map((x) => decode(x.title)),
  });
}

export async function workshop(ctx, cm) {
  const w = await instanceOf(ctx, 'mod_workshop_get_workshops_by_courses', 'workshops', cm);
  const [plan, grades] = await ctx.ws.batch([
    { fn: 'mod_workshop_get_user_plan', args: { workshopid: cm.instance } },
    { fn: 'mod_workshop_get_grades', args: { workshopid: cm.instance } },
  ]);
  return compact({
    ...introOf(w),
    phases: (plan.data?.userplan?.phases ?? []).map((p) => compact({
      title: decode(p.title),
      active: p.active || undefined,
      tasks: (p.tasks ?? []).map((t) => compact({ title: htmlToText(t.title), done: isDone(t.completed) || undefined })),
    })),
    submissionGrade: grades.data?.submissionlongstrgrade || undefined,
    assessmentGrade: grades.data?.assessmentlongstrgrade || undefined,
  });
}

export async function h5pactivity(ctx, cm) {
  const h = await instanceOf(ctx, 'mod_h5pactivity_get_h5pactivities_by_courses', 'h5pactivities', cm);
  const r = await ctx.ws.call('mod_h5pactivity_get_attempts', { h5pactivityid: cm.instance });
  return compact({
    ...introOf(h),
    attempts: (r.usersattempts?.[0]?.attempts ?? []).map((a) => compact({
      number: a.attempt,
      date: toIso(a.timecreated),
      score: a.maxscore ? `${a.rawscore}/${a.maxscore}` : undefined,
      success: a.success ?? undefined,
      duration: a.duration || undefined,
    })),
  });
}

export async function bigbluebuttonbn(ctx, cm) {
  const b = await instanceOf(ctx, 'mod_bigbluebuttonbn_get_bigbluebuttonbns_by_courses', 'bigbluebuttonbns', cm);
  let recordings;
  try {
    const r = await ctx.ws.call('mod_bigbluebuttonbn_get_recordings', { bigbluebuttonbnid: cm.instance });
    recordings = JSON.parse(r.tabledata?.data || '[]').map((row) => compact({
      name: htmlToText(row.recording ?? row.name),
      description: htmlToText(row.description),
      date: row.date ? new Date(Number(row.date)).toISOString() : undefined, // milliseconds
      links: htmlLinks(row.playback, { internal: true }).links,
    }));
  } catch { /* recordings disabled for this room */ }
  return compact({ ...introOf(b), opens: toIso(b?.openingtime), closes: toIso(b?.closingtime), recordings });
}

export async function lti(ctx, cm) {
  const l = await instanceOf(ctx, 'mod_lti_get_ltis_by_courses', 'ltis', cm);
  return compact({ ...introOf(l), note: 'External tool: it opens only in a browser' });
}
